/**
 * Middleware.
 *
 * Ordering matters and is asserted in `app.ts`:
 *   requestContext → securityHeaders → errorBoundary → rateLimit
 *   → requireAccess → csrfProtection → route
 */

import { getCookie } from "hono/cookie";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ApiError } from "../lib/errors.js";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, safeEqual } from "../services/session.js";
import { clientIp, type Env } from "../http.js";
import { randomToken } from "../lib/id.js";

/** Attaches the container, a request id and a scoped logger; logs the result. */
export function requestContext(ctx: Env["Variables"]["ctx"]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? randomToken(8);
    const logger = ctx.logger.child({ requestId });

    c.set("ctx", ctx);
    c.set("requestId", requestId);
    c.set("logger", logger);
    c.header("x-request-id", requestId);

    const startedAt = performance.now();
    await next();
    const duration = Math.round(performance.now() - startedAt);

    const line = {
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      duration,
    };

    /**
     * "Am I signed in?" — "No."
     *
     * `/auth/me` is the SPA's first request on every page load, and a 401 is
     * one of its two correct answers, not a rejection worth a warning. Logging
     * it as one puts a scary line in the terminal of everybody who has simply
     * opened the editor while signed out.
     */
    const expected401 = c.res.status === 401 && line.path === "/api/auth/me";

    if (c.res.status >= 500) logger.error("Request failed", line);
    else if (c.res.status >= 400 && !expected401) logger.warn("Request rejected", line);
    else logger.debug("Request", line);
  };
}

export function securityHeaders(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();

    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "same-origin");
    c.header("x-frame-options", "DENY");
    // The admin is a first-party SPA; nothing here needs to be embedded.
    c.header("permissions-policy", "geolocation=(), microphone=(), camera=()");
  };
}

/**
 * Converts thrown errors into the API error envelope. Deliberate failures
 * (`ApiError`) are reported as-is; anything else is a bug and becomes a bare
 * 500, with the stack kept in the log rather than sent to the client.
 *
 * Registered with `app.onError`, not as middleware: Hono's `compose` wraps each
 * handler individually and routes a throw to `onError` at that level, so a
 * try/catch in an outer middleware would never see it.
 */
export function errorHandler(): ErrorHandler<Env> {
  return (error, c) => {
    const logger = c.get("logger") ?? c.get("ctx").logger;

    if (error instanceof ApiError) {
      logger.debug("Handled error", { code: error.code, message: error.message });
      return c.json(error.toBody(), error.status as ContentfulStatusCode, error.headers);
    }

    logger.error("Unhandled error", {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      path: new URL(c.req.url).pathname,
    });

    return c.json(
      {
        error: {
          code: "internal_error" as const,
          message: "Something went wrong. Please try again.",
          requestId: c.get("requestId"),
        },
      },
      500,
    );
  };
}

/** Coarse per-IP limit, applied to the whole API surface. */
export function rateLimit(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { limiters } = c.get("ctx");
    const result = limiters.api.check(clientIp(c));

    if (!result.allowed) {
      throw new ApiError("rate_limited", "Too many requests. Please slow down.", {
        headers: { "retry-after": String(result.retryAfter) },
      });
    }

    await next();
  };
}

/**
 * Rejects the request unless there is a live session, and — outside local mode
 * — unless the person it belongs to is still admitted.
 */
export function requireAccess(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const ctx = c.get("ctx");
    const session = ctx.services.sessions.resolve(getCookie(c, SESSION_COOKIE));

    if (!session) {
      throw new ApiError("unauthenticated", "Your session has expired. Please sign in again.");
    }

    /**
     * Local mode: a session with nobody in it.
     *
     * The cookie still matters — it carries the CSRF token, and it is why a
     * page that has not been served by this server cannot drive the API — but
     * there is no identity behind it and nothing to admit.
     */
    if (ctx.config.authDisabled) {
      c.set("access", { identity: null, session });
      await next();
      return;
    }

    const { identity } = session;
    if (!identity) {
      // A session from a local-mode run of the same database. It authenticates
      // nobody, so it is not a session for an authenticated deployment.
      ctx.repositories.sessions.delete(session.id);
      throw new ApiError("unauthenticated", "Please sign in again.");
    }

    /**
     * Admission is re-read on every request, not decided once at sign-in.
     *
     * That is what makes a configuration change immediate: an operator who
     * takes somebody out of `MICA_ADMIT_SUBJECTS` and restarts has removed
     * them, rather than waiting for a cookie to expire. What it cannot make
     * immediate is a group removal at the provider — the claims here are the
     * ones the provider sent, and Mica learns better at the next sign-in.
     */
    const verdict = ctx.services.admission.admits(identity);
    if (!verdict.admitted) {
      c.get("logger").warn("Session no longer admitted", {
        subject: identity.subject,
        reason: verdict.reason,
      });
      throw new ApiError("forbidden", "You no longer have access to this site.");
    }

    c.set("access", { identity, session });
    await next();
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const normaliseOrigin = (value: string): string => {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
};

export function allowedOrigins(config: {
  MICA_PUBLIC_URL: string;
  adminOrigins: string[];
}): string[] {
  return [...new Set([config.MICA_PUBLIC_URL, ...config.adminOrigins].map(normaliseOrigin))];
}

/**
 * First CSRF layer: the browser sets `Origin` on every state-changing request
 * and a page on another site cannot forge it.
 *
 * Applied to the whole API — including sign-in, which has no session yet and
 * so cannot use the token check below.
 */
export function originGuard(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const { config } = c.get("ctx");
    const origin = c.req.header("origin");

    if (origin) {
      if (!allowedOrigins(config).includes(normaliseOrigin(origin))) {
        throw new ApiError("forbidden", "Request origin is not allowed.");
      }
    } else if (config.isProduction) {
      // A browser always sends Origin on writes; its absence means the request
      // did not come from one. Tolerated in development for curl-based testing.
      throw new ApiError("forbidden", "Missing Origin header.");
    }

    await next();
  };
}

/**
 * Second CSRF layer: double-submit token. The session's token is issued in a
 * cookie the SPA can read and must be echoed in a header. Cross-origin
 * JavaScript can neither read the cookie nor set the header.
 *
 * Runs after `requireAccess`, and complements the session cookie's `SameSite=Lax`
 * which already blocks the classic cross-site form post.
 */
export function csrfProtection(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const { session } = c.get("access");
    const header = c.req.header(CSRF_HEADER);
    const cookie = getCookie(c, CSRF_COOKIE);

    if (!header || !cookie || !safeEqual(header, cookie) || !safeEqual(header, session.csrfToken)) {
      throw new ApiError("forbidden", "Invalid or missing CSRF token. Reload the page and retry.");
    }

    await next();
  };
}

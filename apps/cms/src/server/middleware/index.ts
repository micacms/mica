/**
 * Middleware.
 *
 * Ordering matters and is asserted in `app.ts`:
 *   requestContext → securityHeaders → errorBoundary → rateLimit
 *   → requireAuth → csrfProtection → route
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

    if (c.res.status >= 500) logger.error("Request failed", line);
    else if (c.res.status >= 400) logger.warn("Request rejected", line);
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

/** Rejects the request unless a valid session cookie is present. */
export function requireAuth(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const ctx = c.get("ctx");
    const session = ctx.services.sessions.resolve(getCookie(c, SESSION_COOKIE));

    if (!session) {
      throw new ApiError("unauthenticated", "Your session has expired. Please sign in again.");
    }

    const user = ctx.repositories.users.findById(session.userId);
    if (!user) {
      // The account was deleted while the session was still alive.
      ctx.repositories.sessions.delete(session.id);
      throw new ApiError("unauthenticated", "This account no longer exists.");
    }

    c.set("session", session);
    c.set("user", user);
    await next();
  };
}

export function requireAdmin(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (c.get("user").role !== "admin") {
      throw new ApiError("forbidden", "This action requires an administrator account.");
    }
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

export function allowedOrigins(config: { CMS_BASE_URL: string; adminOrigins: string[] }): string[] {
  return [...new Set([config.CMS_BASE_URL, ...config.adminOrigins].map(normaliseOrigin))];
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
 * Runs after `requireAuth`, and complements the session cookie's `SameSite=Lax`
 * which already blocks the classic cross-site form post.
 */
export function csrfProtection(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const session = c.get("session");
    const header = c.req.header(CSRF_HEADER);
    const cookie = getCookie(c, CSRF_COOKIE);

    if (!header || !cookie || !safeEqual(header, cookie) || !safeEqual(header, session.csrfToken)) {
      throw new ApiError("forbidden", "Invalid or missing CSRF token. Reload the page and retry.");
    }

    await next();
  };
}

/** Bearer-token guard for the read-only content API used by the build. */
export function requireReadToken(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { config } = c.get("ctx");
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const presented = match?.[1] ?? c.req.query("token");

    if (!presented || !safeEqual(presented, config.readToken)) {
      throw new ApiError("unauthenticated", "A valid read token is required.");
    }

    await next();
  };
}

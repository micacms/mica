/**
 * Middleware.
 *
 * Ordering matters and is asserted in `app.ts`:
 *   requestContext → guards → securityHeaders → errorBoundary → rateLimit
 *   → originGuard → the auth surface's gate → route
 *
 * The gate itself is not here. Whether a request is anybody — a session
 * middleware, `allowAll()` — belongs to the composing app, which is what
 * keeps this package authentication-neutral.
 */

import type { ErrorHandler, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ApiError } from "../lib/errors.js";
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

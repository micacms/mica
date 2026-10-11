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

import { ContentPathError } from "@micacms/core";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ApiError, badRequest } from "../lib/errors.js";
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

/**
 * Same-origin only. `blob:` and `data:` images cover previews; a route that
 * needs a stricter policy, such as the sandbox on media files, sets its own.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();

    if (!c.res.headers.has("content-security-policy")) {
      c.header("content-security-policy", CONTENT_SECURITY_POLICY);
    }
    // Only for an https public URL: HSTS over plain HTTP is ignored, and on
    // localhost it would pin a developer's other projects to https.
    if (c.get("ctx").config.MICA_PUBLIC_URL.startsWith("https://")) {
      c.header("strict-transport-security", "max-age=31536000");
    }

    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "same-origin");
    c.header("x-frame-options", "DENY");
    // The admin is a first-party SPA; nothing here needs to be embedded.
    c.header("permissions-policy", "geolocation=(), microphone=(), camera=()");
  };
}

/** Files in one upload request; the Media view sends a selection in one request. */
export const MAX_FILES_PER_UPLOAD = 10;

/** Far more than any entry's JSON, and small enough to refuse a flood early. */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;

/**
 * Refuses an oversized body before a handler reads it into memory (#148). An
 * upload may carry `MAX_FILES_PER_UPLOAD` files of `MAX_UPLOAD_BYTES`, plus
 * room for the multipart framing; every other request gets `MAX_JSON_BYTES`.
 */
export function requestSizeLimit(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { config } = c.get("ctx");
    const upload = c.req.method === "POST" && c.req.path === "/api/admin/media";
    const maxSize = upload
      ? config.MAX_UPLOAD_BYTES * MAX_FILES_PER_UPLOAD + 1024 * 1024
      : MAX_JSON_BYTES;

    return bodyLimit({
      maxSize,
      onError: (ctx) => {
        const refused = new ApiError(
          "payload_too_large",
          upload
            ? "The upload is too large. Upload fewer or smaller files at a time."
            : "The request is too large.",
        );
        return ctx.json(refused.toBody(), 413);
      },
    })(c, next);
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

    // A path that could leave the content root is the client's mistake, not a bug.
    if (error instanceof ContentPathError) {
      logger.warn("Refused content path", { message: error.message });
      const refused = badRequest(error.message);
      return c.json(refused.toBody(), refused.status as ContentfulStatusCode);
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

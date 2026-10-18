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

import { ContentReadError, ContentSourceError, FormatError, mapHosts, type Site } from "@micacms/core/internal";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ApiError } from "../lib/errors.js";
import { clientIp, type Env } from "../http.js";
import { randomToken } from "../lib/id.js";
import { ReadOnlyError, UnknownContentError, ValidationError } from "../services/content-store.js";
import { ConflictError, FilesError } from "../workspace/files.js";

/** Attaches the container, a request id and a scoped logger; logs the result. */
export function requestContext(ctx: Env["Variables"]["ctx"]): MiddlewareHandler<Env> {
  return async (c, next) => {
    // A client's id is logged and echoed, so only a short, plain one is kept (#150).
    const offered = c.req.header("x-request-id");
    const requestId = offered && /^[A-Za-z0-9_-]{1,64}$/.test(offered) ? offered : randomToken(8);
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
 * Same-origin only, unless a coordinates field has a map. `blob:` and `data:`
 * images cover previews; a route that needs a stricter policy, such as the
 * sandbox on media files, sets its own.
 *
 * A map adds the hosts that the model names for it, and `blob:` workers: the
 * editor starts MapLibre's worker from a `blob:` address, so that the worker
 * keeps this page's policy and not the one cached with its script.
 */
export function contentSecurityPolicy(model: Site): string {
  const hosts = mapHosts(model);
  const map = hosts.length > 0 ? [`connect-src 'self' ${hosts.join(" ")}`, "worker-src 'self' blob:"] : [];
  return [
    "default-src 'self'",
    ["img-src 'self' blob: data:", ...hosts].join(" "),
    ...map,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// The model changes rarely, and each change is a new object.
const policies = new WeakMap<Site, string>();
const policyFor = (model: Site): string => {
  let policy = policies.get(model);
  if (policy === undefined) policies.set(model, (policy = contentSecurityPolicy(model)));
  return policy;
};

export function securityHeaders(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();

    if (!c.res.headers.has("content-security-policy")) {
      c.header("content-security-policy", policyFor(c.get("ctx").site.model));
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

/** Far more than any entry's JSON, and small enough to refuse a flood early. */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;

/**
 * Refuses an oversized body before a handler reads it into memory (#148). An
 * upload streams to disk and the media service counts its bytes, because this
 * middleware holds a body without a Content-Length in memory.
 */
export function requestSizeLimit(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (c.req.method === "POST" && c.req.path === "/api/admin/media") return next();

    return bodyLimit({
      maxSize: MAX_JSON_BYTES,
      onError: (ctx) => ctx.json(new ApiError("payload_too_large", "The request is too large.").toBody(), 413),
    })(c, next);
  };
}

/**
 * The API error for a failure of the content or its files, the same for every
 * interface: a conflict or a read-only part is 409, a validation 422, a file
 * that cannot be read 422 with its path, an unknown collection or singleton
 * 404, and any other content error 400. Null for anything else: a bug.
 */
export function apiErrorOf(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  if (error instanceof ConflictError || error instanceof ReadOnlyError) return new ApiError("conflict", error.message, { cause: error });
  if (error instanceof ValidationError) return new ApiError("validation_failed", error.message, { issues: error.issues, cause: error });
  if (error instanceof ContentReadError) return new ApiError("unreadable_content", error.message, { path: error.path, cause: error });
  if (error instanceof UnknownContentError) return new ApiError("not_found", error.message, { cause: error });
  if (error instanceof FilesError || error instanceof ContentSourceError || error instanceof FormatError) {
    return new ApiError("bad_request", error.message, { cause: error });
  }
  return null;
}

/**
 * Converts thrown errors into the API error envelope with `apiErrorOf`;
 * anything else is a bug and becomes a bare 500, with the stack kept in the
 * log rather than sent to the client.
 *
 * Registered with `app.onError`, not as middleware: Hono's `compose` wraps each
 * handler individually and routes a throw to `onError` at that level, so a
 * try/catch in an outer middleware would never see it.
 */
export function errorHandler(): ErrorHandler<Env> {
  return (error, c) => {
    const logger = c.get("logger") ?? c.get("ctx").logger;

    const refused = apiErrorOf(error);
    if (refused) {
      logger.debug("Handled error", { code: refused.code, message: refused.message });
      return c.json(refused.toBody(), refused.status as ContentfulStatusCode, refused.headers);
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
    } else if (!config.isLoopback) {
      // A browser always sends Origin on writes; its absence means the request
      // did not come from one. Tolerated on this machine, for curl-based testing.
      throw new ApiError("forbidden", "Missing Origin header.");
    }

    await next();
  };
}

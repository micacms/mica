/**
 * Assembles the app: health, the admin API, the admin SPA and the composing
 * app's own routes, such as `/mcp`. There is no public content API and no
 * `/media/*`; a website builds from the repository, not from this server.
 * Authentication comes from the composing app.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

import type { RuntimeContext } from "./context.js";
import type { Env } from "./http.js";
import {
  allowedOrigins,
  errorHandler,
  originGuard,
  requestSizeLimit,
  rateLimit,
  requestContext,
  securityHeaders,
} from "./middleware/index.js";
import { adminContentRoutes } from "./routes/admin-content.js";
import { adminMediaRoutes } from "./routes/admin-media.js";
import { adminSpaRoutes, adminAssetsExist } from "./routes/admin-spa.js";
import { adminStagingRoutes } from "./routes/admin-staging.js";
import { adminSystemRoutes } from "./routes/admin-system.js";
import { healthRoutes } from "./routes/health.js";

/** What a composing app contributes around the auth-neutral runtime. */
export interface AuthSurface {
  /** Mounted at `/api/auth`: sign-in, callback, logout, whatever auth needs. */
  routes: Hono<Env>;
  /** Applied before every `/api/admin` route. Must set `access` or refuse the request. */
  gate: MiddlewareHandler<Env>[];
}

/**
 * Allows every request with no identity. Safe only because the local editor is
 * loopback-bound and Host-guarded.
 */
export function allowAll(): MiddlewareHandler<Env> {
  return async (c, next) => {
    c.set("access", { identity: null });
    await next();
  };
}

/** `/api/auth/config` with nothing behind it: the SPA's cue to skip sign-in. */
function unauthenticatedSurface(): AuthSurface {
  const routes = new Hono<Env>();
  routes.get("/config", (c) => c.json({ authRequired: false, provider: null }));
  return { routes, gate: [allowAll()] };
}

export interface CreateAppOptions {
  /** Absent means the unauthenticated local surface. */
  auth?: AuthSurface;
  /**
   * Middleware in front of everything, so the local editor's Host allowlist
   * also guards the health endpoints.
   */
  guards?: MiddlewareHandler<Env>[];
  adminDir?: string;
  /** More routes from the composing app, such as `/mcp`, mounted at the root. Each brings its own gate. */
  routes?: Hono<Env>[];
}

export function createApp(ctx: RuntimeContext, options: CreateAppOptions = {}): Hono<Env> {
  const app = new Hono<Env>();
  const auth = options.auth ?? unauthenticatedSurface();

  app.use("*", requestContext(ctx));
  for (const guard of options.guards ?? []) app.use("*", guard);
  app.use("*", securityHeaders());
  app.onError(errorHandler());

  app.route("/", healthRoutes());

  // Only for the Vite dev server on another origin; in production the SPA is same-origin.
  if (ctx.config.adminOrigins.length > 0) {
    app.use(
      "/api/*",
      cors({
        origin: allowedOrigins(ctx.config),
        credentials: true,
        allowHeaders: ["content-type", "x-csrf-token"],
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      }),
    );
  }

  app.use("/api/*", rateLimit());
  app.use("/api/*", originGuard());
  app.use("/api/*", requestSizeLimit());

  app.route("/api/auth", auth.routes);

  // One gate and no roles: whoever the surface admits is an editor of this site.
  for (const middleware of auth.gate) app.use("/api/admin/*", middleware);
  // A model pushed or written since is used at once; editors cannot restart the server.
  app.use("/api/admin/*", async (c, next) => {
    await c.get("ctx").refreshModel();
    await next();
  });

  app.route("/api/admin", adminSystemRoutes());
  app.route("/api/admin", adminContentRoutes());
  app.route("/api/admin", adminStagingRoutes());
  app.route("/api/admin/media", adminMediaRoutes());

  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found" as const, message: "No such endpoint." } }, 404),
  );

  for (const routes of options.routes ?? []) app.route("/", routes);

  const adminDir = options.adminDir;

  if (adminDir && adminAssetsExist(adminDir)) {
    app.route("/admin", adminSpaRoutes(adminDir));
  } else {
    app.get("/admin/*", (c) =>
      c.text(
        "The admin interface has not been built.\n" +
          "Run `rush build`, or use `rush dev` and open the Vite dev server.",
        503,
      ),
    );
  }

  app.get("/", (c) => c.redirect("/admin/"));

  app.notFound((c) => c.text("Not found", 404));

  return app;
}

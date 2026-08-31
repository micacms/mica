/**
 * Application assembly.
 *
 *   cms.example.com
 *          │
 *          ▼
 *         Hono
 *   ┌──────┴───┬──────────┐
 *   │          │          │
 * /api/*    /admin/*   /health
 *   │          │
 * connector  Vue SPA
 *   │
 * content repository
 *
 * There is no public content API and no `/media/*`. A website is built from the
 * repository, not from this server, so nothing here has to be reachable for a
 * site to deploy — or to stay up.
 *
 * Authentication is not assembled here — it is *received*. The composing app
 * hands in an `AuthSurface`: routes for `/api/auth`, and the gate applied in
 * front of every admin route. The self-hosted app passes the OIDC surface
 * from `@micacms/auth-oidc`; the local editor passes nothing and gets the
 * unauthenticated surface below, which is a statement of fact — on your own
 * machine there is nobody to be — not a bypass of anything.
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
  /**
   * Applied before every `/api/admin` route, in order. Must either set the
   * `access` variable or refuse the request — nothing behind it runs without
   * an `AccessContext`.
   */
  gate: MiddlewareHandler<Env>[];
}

/**
 * The unauthenticated surface: every request is allowed, and none is anybody.
 *
 * An authorization policy, not authentication code. It exists so action
 * checks stay uniform without inventing a user, and it is safe only because
 * the local editor is loopback-bound and Host-guarded by construction.
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
   * Extra middleware in front of everything — the local editor's Host
   * allowlist goes here, so even /health answers only to this machine.
   */
  guards?: MiddlewareHandler<Env>[];
  /** Where the built admin SPA is served from. */
  adminDir?: string;
}

export function createApp(ctx: RuntimeContext, options: CreateAppOptions = {}): Hono<Env> {
  const app = new Hono<Env>();
  const auth = options.auth ?? unauthenticatedSurface();

  /* ---------------------------------------------------------- baseline */

  app.use("*", requestContext(ctx));
  for (const guard of options.guards ?? []) app.use("*", guard);
  app.use("*", securityHeaders());
  app.onError(errorHandler());

  /* ------------------------------------------------------------ health */

  app.route("/health", healthRoutes());

  /* --------------------------------------------------------------- API */

  // In development the SPA is served by Vite on another origin, so the API has
  // to accept credentialed cross-origin calls from it. In production the SPA is
  // same-origin and ADMIN_ORIGINS is normally empty.
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

  app.route("/api/auth", auth.routes);

  /* ------------------------------------------------------- admin API */

  // One gate, and no second one behind it: whoever the surface admits is an
  // editor of this site. There are no roles, because there are no accounts to
  // hang them on.
  for (const middleware of auth.gate) app.use("/api/admin/*", middleware);

  app.route("/api/admin", adminSystemRoutes());
  app.route("/api/admin", adminContentRoutes());
  app.route("/api/admin", adminStagingRoutes());
  app.route("/api/admin/media", adminMediaRoutes());

  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found" as const, message: "No such endpoint." } }, 404),
  );

  /* --------------------------------------------------------- admin SPA */

  const adminDir = options.adminDir ?? ctx.config.ADMIN_DIR;

  if (adminDir && adminAssetsExist(adminDir)) {
    app.route("/admin", adminSpaRoutes(adminDir));
  } else {
    // Running from source with only the API built: point at the Vite server
    // rather than returning a blank 404.
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

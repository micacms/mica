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
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import type { AppContext } from "./context.js";
import type { Env } from "./http.js";
import {
  allowedOrigins,
  csrfProtection,
  errorHandler,
  originGuard,
  rateLimit,
  requestContext,
  requireAccess,
  securityHeaders,
} from "./middleware/index.js";
import { adminContentRoutes } from "./routes/admin-content.js";
import { adminMediaRoutes } from "./routes/admin-media.js";
import { adminSpaRoutes, adminAssetsExist, defaultAdminDir } from "./routes/admin-spa.js";
import { adminStagingRoutes } from "./routes/admin-staging.js";
import { adminSystemRoutes } from "./routes/admin-system.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";

export interface CreateAppOptions {
  /** Overridden by the tests; defaults to the directory Vite builds into. */
  adminDir?: string;
}

export function createApp(ctx: AppContext, options: CreateAppOptions = {}): Hono<Env> {
  const app = new Hono<Env>();

  /* ---------------------------------------------------------- baseline */

  app.use("*", requestContext(ctx));
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

  app.route("/api/auth", authRoutes());

  /* ------------------------------------------------------- admin API */

  // One gate, and no second one behind it: admission decides who gets in, and
  // everybody who gets in is an editor of this site. There are no roles,
  // because there are no accounts to hang them on.
  app.use("/api/admin/*", requireAccess());
  app.use("/api/admin/*", csrfProtection());

  app.route("/api/admin", adminSystemRoutes());
  app.route("/api/admin", adminContentRoutes());
  app.route("/api/admin", adminStagingRoutes());
  app.route("/api/admin/media", adminMediaRoutes());

  app.all("/api/*", (c) =>
    c.json({ error: { code: "not_found" as const, message: "No such endpoint." } }, 404),
  );

  /* --------------------------------------------------------- admin SPA */

  const adminDir = options.adminDir ?? ctx.config.ADMIN_DIR ?? defaultAdminDir();

  if (adminAssetsExist(adminDir)) {
    app.route("/admin", adminSpaRoutes(adminDir));
  } else {
    // Running from source with only the API built: point at the Vite server
    // rather than returning a blank 404.
    app.get("/admin/*", (c) =>
      c.text(
        "The admin interface has not been built.\n" +
          "Run `pnpm build:admin`, or use `pnpm dev` and open the Vite dev server.",
        503,
      ),
    );
  }

  app.get("/", (c) => c.redirect("/admin/"));

  app.notFound((c) => c.text("Not found", 404));

  return app;
}

/**
 * Application assembly.
 *
 *   cms.example.com
 *          │
 *          ▼
 *         Hono
 *   ┌──────┼──────────┬─────────┐
 *   │      │          │         │
 * /api/*  /media/*  /admin/*  /health
 *   │      │          │
 * SQLite  files    Vue SPA
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
  requireAdmin,
  requireAuth,
  requireReadToken,
  securityHeaders,
} from "./middleware/index.js";
import { adminContentRoutes } from "./routes/admin-content.js";
import { adminMediaRoutes } from "./routes/admin-media.js";
import { adminSpaRoutes, adminAssetsExist, defaultAdminDir } from "./routes/admin-spa.js";
import { adminSystemRoutes } from "./routes/admin-system.js";
import { adminUserRoutes } from "./routes/admin-users.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { mediaFileRoutes } from "./routes/media-files.js";
import { publicRoutes } from "./routes/public.js";

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

  /* ------------------------------------------------------------- media */

  // Public: these URLs are fetched by the image pipeline during `astro build`,
  // which cannot present credentials. See routes/media-files.ts.
  app.route("/media", mediaFileRoutes());

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

  app.use("/api/admin/*", requireAuth());
  app.use("/api/admin/*", csrfProtection());
  // User management is administrator-only; everything else is open to editors.
  app.use("/api/admin/users", requireAdmin());
  app.use("/api/admin/users/*", requireAdmin());

  app.route("/api/admin", adminSystemRoutes());
  app.route("/api/admin", adminContentRoutes());
  app.route("/api/admin/media", adminMediaRoutes());
  app.route("/api/admin/users", adminUserRoutes());

  /* ------------------------------------------------------ public API */

  for (const path of ["/api/version", "/api/manifest", "/api/content/*", "/api/globals/*"]) {
    app.use(path, requireReadToken());
  }
  app.route("/api", publicRoutes());

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

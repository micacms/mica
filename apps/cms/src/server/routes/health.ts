/**
 * Health endpoint for container orchestration and uptime monitoring.
 *
 * Actually touches the database — a process that is listening but cannot read
 * its own storage is not healthy, and a check that only proves the event loop
 * is alive would not notice.
 */

import { Hono } from "hono";

import type { Env } from "../http.js";

const startedAt = Date.now();

export function healthRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/", (c) => {
    const ctx = c.get("ctx");

    try {
      ctx.db.get<{ ok: number }>("SELECT 1 AS ok");
    } catch (error) {
      c.get("logger").error("Health check failed", { error: String(error) });
      return c.json({ status: "error", database: "unavailable" }, 503);
    }

    return c.json({
      status: "ok",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      database: "ok",
      publisher: ctx.publisher.status().configured ? "configured" : "not configured",
    });
  });

  return app;
}

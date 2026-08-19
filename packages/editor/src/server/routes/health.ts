/**
 * Health endpoint for container orchestration and uptime monitoring.
 *
 * Touches both things a request could need: the database that holds sessions,
 * and the content repository. A process that is listening but cannot reach
 * either is not healthy, and a check that only proves the event loop is alive
 * would not notice.
 */

import { Hono } from "hono";

import type { Env } from "../http.js";

const startedAt = Date.now();

export function healthRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.get("/", async (c) => {
    const ctx = c.get("ctx");

    try {
      ctx.db.get<{ ok: number }>("SELECT 1 AS ok");
    } catch (error) {
      c.get("logger").error("Health check failed", { error: String(error) });
      return c.json({ status: "error", database: "unavailable" }, 503);
    }

    // `list` on a missing root returns an empty array rather than throwing, so
    // this proves reachability, not that anyone has written content yet.
    try {
      await ctx.site.contentRepository.list("");
    } catch (error) {
      c.get("logger").error("Content repository is unreachable", { error: String(error) });
      return c.json({ status: "error", repository: "unavailable" }, 503);
    }

    return c.json({
      status: "ok",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      database: "ok",
      repository: ctx.site.contentRepository.origin,
    });
  });

  return app;
}

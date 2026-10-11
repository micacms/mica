/**
 * Health endpoints for container orchestration and uptime monitoring.
 *
 *   /health/live   the process answers. No I/O: a provider outage must not
 *                  restart a container that would not be any better for it.
 *   /health/ready  the database, where the composition has one, and the
 *                  content repository. Cached, because each probe spends one
 *                  call of the repository token's quota and anybody can ask.
 *   /health        the same as /health/ready, so existing checks keep working.
 *
 * Neither answer names the repository or the uptime: the endpoints are public,
 * and the System view shows both to editors (#79).
 */

import { Hono, type Context } from "hono";

import type { Env } from "../http.js";

type Check = "ok" | "unavailable";

interface Readiness {
  status: "ok" | "error";
  database?: Check;
  repository: Check;
}

export interface HealthOptions {
  /** How long a readiness result is reused. */
  cacheMs?: number;
  now?: () => number;
}

export function healthRoutes(options: HealthOptions = {}): Hono<Env> {
  const cacheMs = options.cacheMs ?? 30_000;
  const now = options.now ?? Date.now;
  // The promise, not the result: requests that arrive during a probe share it.
  let cached: { at: number; result: Promise<Readiness> } | null = null;

  const app = new Hono<Env>();

  app.get("/live", (c) => c.json({ status: "ok" }));

  const ready = async (c: Context<Env>) => {
    if (!cached || now() - cached.at >= cacheMs) {
      cached = { at: now(), result: probe(c) };
    }
    const result = await cached.result;
    return c.json(result, result.status === "ok" ? 200 : 503);
  };
  app.get("/ready", ready);
  app.get("/", ready);

  return app;
}

async function probe(c: Context<Env>): Promise<Readiness> {
  const ctx = c.get("ctx");
  const logger = c.get("logger");
  let database: Check | undefined;

  // A probe only where the composition has a database. The local editor does
  // not, and a health check must not invent one to report on.
  if (ctx.health.database) {
    try {
      ctx.health.database();
      database = "ok";
    } catch (error) {
      logger.error("Health check failed", { error: String(error) });
      database = "unavailable";
    }
  }

  // `list` on a missing root returns an empty array rather than throwing, so
  // this proves reachability, not that anyone has written content yet.
  let repository: Check = "ok";
  try {
    await ctx.site.contentRepository.list("");
  } catch (error) {
    logger.error("Content repository is unreachable", { error: String(error) });
    repository = "unavailable";
  }

  const ok = repository === "ok" && database !== "unavailable";
  return { status: ok ? "ok" : "error", ...(database ? { database } : {}), repository };
}

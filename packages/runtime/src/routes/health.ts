/**
 * `/health` does no I/O, so a repository outage does not restart the container.
 * `/ready` checks the content repository and is cached because it is public.
 * Neither names the repository or the uptime.
 */

import { Hono, type Context } from "hono";

import type { Env } from "../http.js";

type Check = "ok" | "degraded" | "unavailable";

interface Readiness {
  /** `degraded`: the site can be edited, but something needs a person, such as a failing Publish. */
  status: "ok" | "degraded" | "error";
  repository: Check;
  /** Short codes from the composition, such as `auth_failed`. */
  reasons?: string[];
  /** When a sync last reached the Git host. */
  lastSyncAt?: string | null;
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

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/ready", async (c) => {
    if (!cached || now() - cached.at >= cacheMs) {
      cached = { at: now(), result: probe(c) };
    }
    const result = await cached.result;
    return c.json(result, result.status === "error" ? 503 : 200);
  });

  return app;
}

async function probe(c: Context<Env>): Promise<Readiness> {
  const ctx = c.get("ctx");
  const logger = c.get("logger");

  // A managed clone knows whether it can be edited without asking the remote.
  if (ctx.health.ready) {
    const { degraded, reasons, lastSyncAt } = ctx.health.ready();
    const status = degraded ? "degraded" : "ok";
    return { status, repository: status, reasons, lastSyncAt };
  }

  // `list` on a missing root returns an empty array, so this proves reachability only.
  let repository: Check = "ok";
  try {
    await ctx.site.contentRepository.list("");
  } catch (error) {
    logger.error("Content repository is unreachable", { error: String(error) });
    repository = "unavailable";
  }

  return { status: repository === "ok" ? "ok" : "error", repository };
}

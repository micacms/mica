import type { Context } from "hono";

import type { AccessContext } from "@micacms/core";

import type { RuntimeContext } from "./context.js";
import type { Logger } from "./lib/logger.js";

export interface Env {
  Variables: {
    ctx: RuntimeContext;
    logger: Logger;
    requestId: string;
    /**
     * Who this request acts as. The auth surface's gate sets it on every admin
     * route; the runtime never sets it.
     */
    access: AccessContext;
  };
}

/**
 * Client IP. Reads `X-Forwarded-For` only with TRUST_PROXY, or a client could
 * spoof its address past the rate limit. The right-most entry is the address
 * the proxy saw; the entries to its left come from the client.
 */
export function clientIp(c: Context<Env>): string {
  const { config } = c.get("ctx");

  if (config.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for");
    const last = forwarded?.split(",").at(-1)?.trim();
    if (last) return last;
  }

  const info = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return info?.incoming?.socket?.remoteAddress ?? "unknown";
}

/**
 * The commit author. Null in the local editor, where the commit keeps the
 * developer's own Git identity.
 */
export function actorOf(c: Context<Env>): { id: string; email: string; name: string } | null {
  const identity = c.get("access")?.identity;
  return identity ? { id: identity.subject, email: identity.email, name: identity.name } : null;
}

/** Parses a positive integer query parameter, falling back when absent. */
export function intParam(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

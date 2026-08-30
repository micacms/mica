/**
 * Shared HTTP types and small request helpers.
 */

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
     * Who this request acts as. Set by the auth surface's gate — the OIDC
     * gate in the self-hosted app, `allowAll()` in the local editor — and
     * therefore present on every admin route. The runtime consumes it and
     * never produces it: which is the whole of being authentication-neutral.
     */
    access: AccessContext;
  };
}

/**
 * Client IP. `X-Forwarded-For` is only consulted when TRUST_PROXY is set —
 * otherwise a client could spoof its own address and bypass rate limiting.
 */
export function clientIp(c: Context<Env>): string {
  const { config } = c.get("ctx");

  if (config.TRUST_PROXY) {
    const forwarded = c.req.header("x-forwarded-for");
    // The left-most entry is the original client; the rest are proxies.
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
  }

  const info = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return info?.incoming?.socket?.remoteAddress ?? "unknown";
}

/**
 * Who to name as the author of a commit.
 *
 * Null in the local editor, where the connector falls back to the developer's
 * own Git identity — which is the right name for a change made on their
 * machine, and one Mica has no business overwriting.
 */
export function actorOf(c: Context<Env>): { id: string; email: string } | null {
  const identity = c.get("access")?.identity;
  return identity ? { id: identity.subject, email: identity.email } : null;
}

/** Parses a positive integer query parameter, falling back when absent. */
export function intParam(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

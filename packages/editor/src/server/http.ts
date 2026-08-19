/**
 * Shared HTTP types and small request helpers.
 */

import type { Context } from "hono";

import type { AppContext } from "./context.js";
import type { Logger } from "./lib/logger.js";
import type { SessionIdentity, SessionRecord } from "./repositories/sessions.js";

/**
 * What a request is allowed to do, and on whose behalf.
 *
 * There is one answer to the first half: an admitted person has every editor
 * capability on this site (v3-arch §7.3). Mica has no roles, because it has no
 * accounts to attach them to — who may edit is decided by configuration before
 * anybody arrives, and everybody who gets past that decision is an editor.
 *
 * The second half is `null` in local mode. That is not an anonymous user; it
 * is the absence of the concept.
 */
export interface AccessContext {
  identity: SessionIdentity | null;
  session: SessionRecord;
}

export interface Env {
  Variables: {
    ctx: AppContext;
    logger: Logger;
    requestId: string;
    /** Set by `requireAccess`, and therefore present on every admin route. */
    access: AccessContext;
  };
}

export type AppContextOf = Env["Variables"]["ctx"];

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
 * Null in local mode, where the connector falls back to the developer's own
 * Git identity — which is the right name for a change made on their machine,
 * and one Mica has no business overwriting.
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

/**
 * Shared HTTP types and small request helpers.
 */

import type { Context } from "hono";

import type { AppContext } from "./context.js";
import type { Logger } from "./lib/logger.js";
import type { MembershipRecord } from "./repositories/memberships.js";
import type { SessionRecord } from "./repositories/sessions.js";
import type { UserRecord } from "./repositories/users.js";

export interface Env {
  Variables: {
    ctx: AppContext;
    logger: Logger;
    requestId: string;
    user: UserRecord;
    session: SessionRecord;
    /**
     * What this user may do *here*. Set by `requireAuth` alongside the user,
     * because a role belongs to a person on a site rather than to a person.
     */
    membership: MembershipRecord;
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

/** The signed-in actor, in the shape the content service expects. */
export function actorOf(c: Context<Env>): { id: string; email: string } | null {
  const user = c.get("user");
  return user ? { id: user.id, email: user.email } : null;
}

/** Parses a positive integer query parameter, falling back when absent. */
export function intParam(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

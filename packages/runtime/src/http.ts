import type { Context } from "hono";

import type { AccessContext } from "@micacms/core/internal";

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
    /** What the person allowed an agent: set by the bearer gate in front of `/mcp`, absent without one. */
    grant: AgentGrant | undefined;
  };
}

/** The OAuth scopes of an agent's grant: the contract between the gate in front of `/mcp` and the tools. */
export const AGENT_SCOPES = {
  read: "content:read",
  write: "content:write",
  publish: "content:publish",
} as const;

/** An OAuth grant to an agent, as the gate in front of `/mcp` verified it. */
export interface AgentGrant {
  /** The access token itself. */
  token: string;
  clientId: string;
  /** The client's own name, from its metadata. */
  clientName: string;
  scopes: string[];
  /** Seconds since the epoch. */
  expiresAt: number;
  /** The resource the token was issued for: this Mica's `/mcp` address. */
  resource: string;
  /** Where a client finds the authorization server, for a scope challenge. */
  resourceMetadataUrl: string;
}

/**
 * Client IP. Reads `X-Forwarded-For` only with MICA_TRUST_PROXY, or a client could
 * spoof its address past the rate limit. The right-most entry is the address
 * the proxy saw; the entries to its left come from the client.
 */
export function clientIp(c: Context<Env>): string {
  const { config } = c.get("ctx");

  if (config.MICA_TRUST_PROXY) {
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

/** Who did it, for the log: the signed-in editor's email, else their subject. None in the local editor. */
export function editorOf(c: Context<Env>): string | undefined {
  const actor = actorOf(c);
  return actor ? actor.email || actor.id : undefined;
}

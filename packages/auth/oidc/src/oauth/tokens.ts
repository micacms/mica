/**
 * The tokens that Mica issues to agents: an authorization code, an access
 * token and a refresh token. Each is sealed, like the session cookie, so Mica
 * stores none of them and cannot revoke one; rotating MICA_SESSION_SECRET ends
 * them all.
 *
 * A grant lives as long as the sign-in that made it: `MICA_SESSION_TTL_HOURS`.
 * That keeps the bound of the session: the claims that admission checks are
 * never older than that.
 */

import { randomBytes } from "node:crypto";

import { seal, sealingKey, unseal } from "../sealed.js";
import type { SessionIdentity } from "../session.js";

export type TokenKind = "authorize" | "code" | "access" | "refresh";

/** How long each kind is valid, at most. The grant's end caps the access and refresh tokens. */
const LIFETIME_MS: Record<Exclude<TokenKind, "refresh">, number> = {
  /** The consent page: time to read it. */
  authorize: 10 * 60_000,
  /** One redirect and one token request. */
  code: 60_000,
  access: 60 * 60_000,
};

/** What a person allowed an agent. Every token of one grant carries it. */
export interface Grant {
  clientId: string;
  clientName: string;
  scopes: string[];
  /** The MCP server's address, which the token is for (RFC 8707). */
  resource: string;
  identity: SessionIdentity;
  /** When the sign-in that made the grant ends, in milliseconds. */
  endsAt: number;
}

/** The consent page's validated request, carried through the form. */
interface AuthorizeRequest {
  clientId: string;
  clientName: string;
  /** The client's address was verified by its metadata document, not only claimed. */
  verified: boolean;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  scopes: string[];
  resource: string;
}

interface CodeExtra {
  redirectUri: string;
  codeChallenge: string;
}

type Payload<K extends TokenKind> = K extends "authorize"
  ? AuthorizeRequest
  : K extends "code"
    ? Grant & CodeExtra
    : Grant;

interface Sealed<K extends TokenKind> {
  kind: K;
  /** Unique, so that a code is used once. */
  id: string;
  expiresAt: number;
  value: Payload<K>;
}

export interface Opened<K extends TokenKind> {
  id: string;
  expiresAt: number;
  value: Payload<K>;
}

export function createTokens(secret: string) {
  const key = sealingKey(secret, "mica agent tokens v1");

  return {
    /** A new token. `expiresAt` is capped by the grant's end where there is one. */
    issue<K extends TokenKind>(kind: K, value: Payload<K>, now = Date.now()): { token: string; expiresAt: number } {
      const limit = kind === "refresh" ? Infinity : now + LIFETIME_MS[kind as Exclude<TokenKind, "refresh">];
      const endsAt = "endsAt" in value ? (value as Grant).endsAt : Infinity;
      const expiresAt = Math.min(limit, endsAt);
      const sealed: Sealed<K> = { kind, id: randomBytes(12).toString("base64url"), expiresAt, value };
      return { token: seal(key, sealed), expiresAt };
    },

    /** The token's contents, or null when it is forged, of another kind, or expired. */
    open<K extends TokenKind>(kind: K, token: string, now = Date.now()): Opened<K> | null {
      const json = unseal(key, token);
      if (json === null) return null;
      try {
        const sealed = JSON.parse(json) as Sealed<K>;
        if (sealed.kind !== kind || typeof sealed.expiresAt !== "number" || sealed.expiresAt <= now) return null;
        return { id: sealed.id, expiresAt: sealed.expiresAt, value: sealed.value };
      } catch {
        return null;
      }
    },
  };
}

export type Tokens = ReturnType<typeof createTokens>;

/**
 * Codes that were exchanged, until they expire. A sealed code cannot be marked
 * as used, so the process remembers it; a restart forgets, and the short life
 * and PKCE are what remain.
 */
export function createUsedCodes() {
  const used = new Map<string, number>();
  return {
    /** True the first time for a code, false after that. */
    claim(id: string, expiresAt: number, now = Date.now()): boolean {
      for (const [key, until] of used) if (until <= now) used.delete(key);
      if (used.has(id)) return false;
      used.set(id, expiresAt);
      return true;
    },
  };
}

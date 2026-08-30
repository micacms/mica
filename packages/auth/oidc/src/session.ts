/**
 * Session management.
 *
 * Server-side sessions in SQLite, addressed by an opaque random token held in a
 * Secure/HttpOnly/SameSite cookie. No JWTs: revocation has to be immediate, and
 * a row delete is the simplest way to get it.
 *
 * Three layers of defence on the cookie value:
 *   1. the token is 256 bits from `crypto.randomBytes`;
 *   2. it is HMAC-signed with SESSION_SECRET, so forged or truncated cookies
 *      are rejected without touching the database;
 *   3. only its SHA-256 is stored, so a database dump yields no usable session.
 *
 * Session fixation is handled by never adopting a client-supplied identifier —
 * a token is minted at login and the previous one deleted.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import { clientIp, randomToken, type Env } from "@micacms/runtime";

import type { AuthConfig } from "./config.js";
import type {
  SessionIdentity,
  SessionRecord,
  SessionRepository,
} from "./sessions-repository.js";

export const SESSION_COOKIE = "mica_session";
export const CSRF_COOKIE = "mica_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** Writing `last_seen_at` on every request would be a write per page view. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionService {
  /**
   * `identity` is null in local mode, where there is no provider and no user:
   * the row exists to carry a CSRF token and an expiry, and nothing else.
   */
  create(input: {
    identity: SessionIdentity | null;
    ip?: string | null;
    userAgent?: string | null;
  }): { record: SessionRecord; cookie: string; csrfToken: string };
  resolve(cookieValue: string | undefined): SessionRecord | null;
  destroy(cookieValue: string | undefined): void;
  /** Signs one person out on every device. */
  destroyAllForIdentity(issuer: string, subject: string): void;
  sessionCookieOptions(): CookieOptions;
  csrfCookieOptions(): CookieOptions;
  clearedCookieOptions(): CookieOptions;
  purgeExpired(): number;
}

export interface CookieOptions {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
  maxAge: number;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function sign(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

/** Constant-time string comparison that tolerates differing lengths. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Still compare, so the branch does not leak the length difference.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function createSessionService(
  sessions: SessionRepository,
  config: AuthConfig,
): SessionService {
  const ttlMs = config.SESSION_TTL_HOURS * 3600_000;
  const idleMs = config.SESSION_IDLE_HOURS * 3600_000;

  /** Expiry is the earlier of the idle window and the absolute lifetime. */
  const nextExpiry = (createdAt: number, now: number): string =>
    new Date(Math.min(now + idleMs, createdAt + ttlMs)).toISOString();

  const unwrap = (cookieValue: string | undefined): string | null => {
    if (!cookieValue) return null;
    const separator = cookieValue.lastIndexOf(".");
    if (separator <= 0) return null;

    const token = cookieValue.slice(0, separator);
    const signature = cookieValue.slice(separator + 1);
    if (!safeEqual(signature, sign(token, config.sessionSecret))) return null;

    return token;
  };

  return {
    create({ identity, ip, userAgent }) {
      const token = randomToken(32);
      const csrfToken = randomToken(32);
      const now = Date.now();

      const record = sessions.create({
        id: sha256(token),
        identity,
        csrfToken,
        expiresAt: nextExpiry(now, now),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      });

      return { record, cookie: `${token}.${sign(token, config.sessionSecret)}`, csrfToken };
    },

    resolve(cookieValue) {
      const token = unwrap(cookieValue);
      if (!token) return null;

      const record = sessions.find(sha256(token));
      if (!record) return null;

      const now = Date.now();
      if (Date.parse(record.expiresAt) <= now) {
        sessions.delete(record.id);
        return null;
      }

      if (now - Date.parse(record.lastSeenAt) > TOUCH_INTERVAL_MS) {
        const expiresAt = nextExpiry(Date.parse(record.createdAt), now);
        sessions.touch(record.id, new Date(now).toISOString(), expiresAt);
        return { ...record, lastSeenAt: new Date(now).toISOString(), expiresAt };
      }

      return record;
    },

    destroy(cookieValue) {
      const token = unwrap(cookieValue);
      if (token) sessions.delete(sha256(token));
    },

    destroyAllForIdentity(issuer, subject) {
      sessions.deleteForIdentity(issuer, subject);
    },

    sessionCookieOptions() {
      return {
        path: "/",
        httpOnly: true,
        secure: config.cookieSecure,
        // Lax keeps the cookie on top-level navigations back to the admin
        // while blocking it on cross-site form posts.
        sameSite: "Lax",
        maxAge: Math.floor(ttlMs / 1000),
      };
    },

    csrfCookieOptions() {
      return {
        path: "/",
        // Readable by the SPA on purpose: it echoes the value in a header,
        // which is what makes the double-submit check work.
        httpOnly: false,
        secure: config.cookieSecure,
        sameSite: "Lax",
        maxAge: Math.floor(ttlMs / 1000),
      };
    },

    clearedCookieOptions() {
      return {
        path: "/",
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "Lax",
        maxAge: 0,
      };
    },

    purgeExpired() {
      return sessions.deleteExpired();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Starting one
 * ------------------------------------------------------------------ */

/** Issues the session cookies for a browser that has just been identified. */
export function establishSession(
  c: Context<Env>,
  sessions: SessionService,
  identity: SessionIdentity,
): void {
  // Session fixation: discard whatever identifier the client already holds.
  sessions.destroy(getCookie(c, SESSION_COOKIE));

  const { cookie, csrfToken } = sessions.create({
    identity,
    ip: clientIp(c),
    userAgent: c.req.header("user-agent") ?? null,
  });

  setCookie(c, SESSION_COOKIE, cookie, sessions.sessionCookieOptions());
  setCookie(c, CSRF_COOKIE, csrfToken, sessions.csrfCookieOptions());
}

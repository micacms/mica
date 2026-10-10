/**
 * Session management.
 *
 * The session is the cookie: who the provider said this is, a CSRF token and
 * an expiry, encrypted with a key derived from SESSION_SECRET. There is no
 * session table, so Mica stores nothing about people at all.
 *
 *   - AES-256-GCM, so the cookie can be neither read nor altered. Encrypted and
 *     not only signed, because it carries an email address and groups.
 *   - A fresh random IV per cookie, and a new cookie at every sign-in, so a
 *     client-supplied value is never adopted (session fixation).
 *   - The idle window slides: an active session is re-issued every few
 *     minutes with a later expiry, capped by the absolute lifetime.
 *
 * What this gives up is server-side revocation of one cookie. Sign-out clears
 * it in the browser; a copy taken before then stays valid until it expires.
 * Rotating SESSION_SECRET ends every session at once. The admission rules are
 * still re-read on every request — see gate.ts and docs/decisions.md.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import type { Context } from "hono";
import { setCookie } from "hono/cookie";

import { randomToken, type Env } from "@micacms/runtime";

import type { AuthConfig } from "./config.js";

export const SESSION_COOKIE = "mica_session";
export const CSRF_COOKIE = "mica_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** How often an active session is re-issued with a later idle expiry. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Browsers drop cookies over 4096 bytes; refuse rather than sign in to nothing. */
const MAX_COOKIE_BYTES = 4000;

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** What the identity provider stated about the person holding this session. */
export interface SessionIdentity {
  issuer: string;
  /** Opaque and stable at that issuer. */
  subject: string;
  email: string;
  /** The provider's own `email_verified`. Absent counts as false. */
  emailVerified: boolean;
  name: string;
  /** The groups claim, reduced at sign-in to the groups the rules name. */
  groups: string[];
}

export interface SessionRecord {
  identity: SessionIdentity;
  csrfToken: string;
  createdAt: string;
  /** When the session was last issued; drives the sliding idle window. */
  refreshedAt: string;
  expiresAt: string;
}

export interface SessionService {
  /** Seals a new session. Throws when the identity cannot fit in a cookie. */
  create(identity: SessionIdentity): { record: SessionRecord; cookie: string };
  /** The live session in a cookie, or null for a missing, forged or expired one. */
  resolve(cookieValue: string | undefined): SessionRecord | null;
  /** A later-expiring copy of an active session, or null while it is fresh. */
  refresh(record: SessionRecord): { record: SessionRecord; cookie: string } | null;
  sessionCookieOptions(): CookieOptions;
  csrfCookieOptions(): CookieOptions;
  clearedCookieOptions(): CookieOptions;
}

export interface CookieOptions {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
  maxAge: number;
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

/**
 * Keycloak sends `/mica-editors` where the rule says `mica-editors`; both
 * spellings are the same group — see admission.ts.
 */
const groupName = (group: string): string => group.replace(/^\//, "");

/** Defensive read of a decrypted payload: it was written by us, but checked anyway. */
function parseRecord(json: string): SessionRecord | null {
  try {
    const value = JSON.parse(json) as Partial<SessionRecord>;
    const identity = value.identity;
    if (
      !identity ||
      typeof identity.issuer !== "string" ||
      typeof identity.subject !== "string" ||
      typeof value.csrfToken !== "string" ||
      typeof value.createdAt !== "string" ||
      typeof value.refreshedAt !== "string" ||
      typeof value.expiresAt !== "string"
    ) {
      return null;
    }
    return {
      identity: {
        issuer: identity.issuer,
        subject: identity.subject,
        email: typeof identity.email === "string" ? identity.email : "",
        emailVerified: identity.emailVerified === true,
        name: typeof identity.name === "string" ? identity.name : "",
        groups: Array.isArray(identity.groups)
          ? identity.groups.filter((group): group is string => typeof group === "string")
          : [],
      },
      csrfToken: value.csrfToken,
      createdAt: value.createdAt,
      refreshedAt: value.refreshedAt,
      expiresAt: value.expiresAt,
    };
  } catch {
    return null;
  }
}

export function createSessionService(config: AuthConfig): SessionService {
  const ttlMs = config.SESSION_TTL_HOURS * 3600_000;
  const idleMs = config.SESSION_IDLE_HOURS * 3600_000;

  const key = Buffer.from(
    hkdfSync("sha256", config.sessionSecret, "", "mica session cookie v1", 32),
  );

  // Only the groups a rule names are kept: an Entra token can carry hundreds,
  // and a cookie holds 4 KB. A group added to the rules later counts from the
  // next sign-in.
  const admitted = new Set(config.admitGroups.map(groupName));

  /** Expiry is the earlier of the idle window and the absolute lifetime. */
  const nextExpiry = (createdAt: number, now: number): string =>
    new Date(Math.min(now + idleMs, createdAt + ttlMs)).toISOString();

  const seal = (record: SessionRecord): string => {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
    const cookie = Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");

    if (cookie.length > MAX_COOKIE_BYTES) {
      throw new Error("The session does not fit in a cookie; the identity is too large.");
    }
    return cookie;
  };

  const open = (cookieValue: string): SessionRecord | null => {
    const raw = Buffer.from(cookieValue, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    try {
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      const json = Buffer.concat([
        decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
      return parseRecord(json);
    } catch {
      // Forged, truncated, or sealed with a secret that has since rotated.
      return null;
    }
  };

  return {
    create(identity) {
      const now = Date.now();
      const record: SessionRecord = {
        identity: {
          ...identity,
          groups: identity.groups.filter((group) => admitted.has(groupName(group))),
        },
        csrfToken: randomToken(32),
        createdAt: new Date(now).toISOString(),
        refreshedAt: new Date(now).toISOString(),
        expiresAt: nextExpiry(now, now),
      };
      return { record, cookie: seal(record) };
    },

    resolve(cookieValue) {
      if (!cookieValue) return null;
      const record = open(cookieValue);
      if (!record || Date.parse(record.expiresAt) <= Date.now()) return null;
      return record;
    },

    refresh(record) {
      const now = Date.now();
      if (now - Date.parse(record.refreshedAt) < REFRESH_INTERVAL_MS) return null;

      const next: SessionRecord = {
        ...record,
        refreshedAt: new Date(now).toISOString(),
        expiresAt: nextExpiry(Date.parse(record.createdAt), now),
      };
      return { record: next, cookie: seal(next) };
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
  const { record, cookie } = sessions.create(identity);

  setCookie(c, SESSION_COOKIE, cookie, sessions.sessionCookieOptions());
  setCookie(c, CSRF_COOKIE, record.csrfToken, sessions.csrfCookieOptions());
}

/**
 * Session management.
 *
 * The session is the cookie: who the provider said this is, a CSRF token and
 * an expiry, encrypted with a key derived from MICA_SESSION_SECRET. There is no
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
 * Rotating MICA_SESSION_SECRET ends every session at once. The admission rules are
 * still re-read on every request — see gate.ts and docs/adr/0004-sealed-sessions-and-no-state-about-people.md.
 */

import { timingSafeEqual } from "node:crypto";

import type { Context } from "hono";
import { setCookie } from "hono/cookie";

import { randomToken, type Env } from "@micacms/runtime";

import type { AuthConfig } from "./config.js";
import { seal as sealValue, sealingKey, unseal } from "./sealed.js";

export const SESSION_COOKIE = "mica_session";
export const CSRF_COOKIE = "mica_csrf";
export const CSRF_HEADER = "x-csrf-token";
const TRANSACTION_COOKIE = "mica_oidc";

export interface CookieNames {
  session: string;
  csrf: string;
  transaction: string;
}

/**
 * With https, the names carry a prefix the browser enforces: `__Host-` means
 * Secure, path `/` and no Domain, so a sibling subdomain cannot plant or
 * overwrite the cookie. The transaction cookie is scoped to `/api/auth`, so it
 * can only be `__Secure-`. Over plain HTTP the cookies are not Secure, and a
 * browser would refuse a prefixed name.
 */
export function cookieNames(secure: boolean): CookieNames {
  return secure
    ? {
        session: `__Host-${SESSION_COOKIE}`,
        csrf: `__Host-${CSRF_COOKIE}`,
        transaction: `__Secure-${TRANSACTION_COOKIE}`,
      }
    : { session: SESSION_COOKIE, csrf: CSRF_COOKIE, transaction: TRANSACTION_COOKIE };
}

/** How often an active session is re-issued with a later idle expiry. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Browsers drop cookies over 4096 bytes; refuse rather than sign in to nothing. */
const MAX_COOKIE_BYTES = 4000;

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
  /** Google's `hd`: the Workspace domain of the account. Absent for other providers and personal accounts. */
  hostedDomain?: string;
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
  /** The cookie names, which depend on whether the cookies are Secure. */
  readonly names: CookieNames;
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

interface CookieOptions {
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
        ...(typeof identity.hostedDomain === "string" ? { hostedDomain: identity.hostedDomain } : {}),
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
  const ttlMs = config.MICA_SESSION_TTL_HOURS * 3600_000;
  const idleMs = config.MICA_SESSION_IDLE_HOURS * 3600_000;

  const key = sealingKey(config.sessionSecret, "mica session cookie v1");

  // Only the groups a rule names are kept: an Entra token can carry hundreds,
  // and a cookie holds 4 KB. A group added to the rules later counts from the
  // next sign-in.
  const admitted = new Set(config.admitGroups.map(groupName));

  /** Expiry is the earlier of the idle window and the absolute lifetime. */
  const nextExpiry = (createdAt: number, now: number): string =>
    new Date(Math.min(now + idleMs, createdAt + ttlMs)).toISOString();

  const seal = (record: SessionRecord): string => {
    const cookie = sealValue(key, record);

    if (cookie.length > MAX_COOKIE_BYTES) {
      throw new Error("The session does not fit in a cookie; the identity is too large.");
    }
    return cookie;
  };

  const open = (cookieValue: string): SessionRecord | null => {
    // Null when forged, truncated, or sealed with a secret that has since rotated.
    const json = unseal(key, cookieValue);
    return json === null ? null : parseRecord(json);
  };

  return {
    names: cookieNames(config.cookieSecure),

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

  setCookie(c, sessions.names.session, cookie, sessions.sessionCookieOptions());
  setCookie(c, sessions.names.csrf, record.csrfToken, sessions.csrfCookieOptions());
}

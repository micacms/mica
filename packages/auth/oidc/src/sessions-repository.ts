/**
 * Session repository.
 *
 * The primary key is the SHA-256 of the cookie token, never the token itself:
 * a leaked database backup therefore does not hand an attacker usable sessions.
 *
 * A row carries who the provider said this is, because there is no user table
 * to look it up in. That is the whole of Mica's identity storage.
 */

import type { SqlDatabase } from "@micacms/runtime";

/**
 * What the identity provider stated about the person holding this session.
 *
 * `null` where there is no provider: local mode has no user, and the row is
 * then a CSRF token with an expiry.
 */
export interface SessionIdentity {
  issuer: string;
  /** Opaque and stable at that issuer. The account key, and never the email. */
  subject: string;
  email: string;
  /** The provider's own `email_verified`. Absent counts as false. */
  emailVerified: boolean;
  name: string;
  /** The groups claim as it arrived, or empty when the provider sends none. */
  groups: string[];
}

export interface SessionRecord {
  id: string;
  identity: SessionIdentity | null;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

interface SessionRow {
  id: string;
  issuer: string | null;
  subject: string | null;
  email: string | null;
  email_verified: number;
  name: string | null;
  groups: string;
  csrf_token: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
}

/**
 * The groups column holds whatever the provider sent, serialised. It is read
 * back defensively — a claim that was a string, or an object, or absent, must
 * not throw four weeks later on a request that has nothing to do with it.
 */
function parseGroups(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    identity:
      row.issuer && row.subject
        ? {
            issuer: row.issuer,
            subject: row.subject,
            email: row.email ?? "",
            emailVerified: row.email_verified === 1,
            name: row.name ?? "",
            groups: parseGroups(row.groups),
          }
        : null,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

const COLUMNS =
  "id, issuer, subject, email, email_verified, name, groups, csrf_token, " +
  "created_at, last_seen_at, expires_at, ip, user_agent";

export function createSessionRepository(db: SqlDatabase) {
  return {
    create(input: {
      id: string;
      identity: SessionIdentity | null;
      csrfToken: string;
      expiresAt: string;
      ip?: string | null;
      userAgent?: string | null;
    }): SessionRecord {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO sessions
           (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.identity?.issuer ?? null,
          input.identity?.subject ?? null,
          input.identity?.email ?? null,
          input.identity?.emailVerified ? 1 : 0,
          input.identity?.name ?? null,
          JSON.stringify(input.identity?.groups ?? []),
          input.csrfToken,
          now,
          now,
          input.expiresAt,
          input.ip ?? null,
          input.userAgent ?? null,
        ],
      );
      return this.find(input.id)!;
    },

    find(id: string): SessionRecord | undefined {
      const row = db.get<SessionRow>(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`, [id]);
      return row && toRecord(row);
    },

    touch(id: string, lastSeenAt: string, expiresAt: string): void {
      db.run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", [
        lastSeenAt,
        expiresAt,
        id,
      ]);
    },

    delete(id: string): boolean {
      return db.run("DELETE FROM sessions WHERE id = ?", [id]).changes > 0;
    },

    /** Every session this person holds, on every device. */
    deleteForIdentity(issuer: string, subject: string): number {
      return db.run("DELETE FROM sessions WHERE issuer = ? AND subject = ?", [issuer, subject])
        .changes;
    },

    deleteExpired(now = new Date().toISOString()): number {
      return db.run("DELETE FROM sessions WHERE expires_at <= ?", [now]).changes;
    },

    count(): number {
      return db.get<{ count: number }>("SELECT COUNT(*) AS count FROM sessions")?.count ?? 0;
    },
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;

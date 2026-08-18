/**
 * Session repository.
 *
 * The primary key is the SHA-256 of the cookie token, never the token itself:
 * a leaked database backup therefore does not hand an attacker usable sessions.
 */

import type { SqlDatabase } from "../db/driver.js";

export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
  };
}

const COLUMNS = "id, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent";

export function createSessionRepository(db: SqlDatabase) {
  return {
    create(input: {
      id: string;
      userId: string;
      csrfToken: string;
      expiresAt: string;
      ip?: string | null;
      userAgent?: string | null;
    }): SessionRecord {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO sessions
           (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.userId,
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

    /** Used when a password changes, so other devices are signed out. */
    deleteForUser(userId: string, exceptId?: string): number {
      return exceptId
        ? db.run("DELETE FROM sessions WHERE user_id = ? AND id != ?", [userId, exceptId]).changes
        : db.run("DELETE FROM sessions WHERE user_id = ?", [userId]).changes;
    },

    deleteExpired(now = new Date().toISOString()): number {
      return db.run("DELETE FROM sessions WHERE expires_at <= ?", [now]).changes;
    },

    listForUser(userId: string): SessionRecord[] {
      return db
        .all<SessionRow>(
          `SELECT ${COLUMNS} FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`,
          [userId],
        )
        .map(toRecord);
    },
  };
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;

/**
 * User repository.
 *
 * A user is now a record of *who someone is*, not of how they prove it. There
 * is no password column: an identity provider does the proving, and
 * `repositories/identities.ts` records which provider subject a user is.
 *
 * There is no role column either. A role is a property of a person on a site,
 * which is what `memberships` is for.
 */

import type { SqlDatabase } from "../db/driver.js";
import { ulid } from "../lib/id.js";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

const COLUMNS = `id, email, name, created_at, updated_at, last_login_at`;

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export function createUserRepository(db: SqlDatabase) {
  return {
    findByEmail(email: string): UserRecord | undefined {
      const row = db.get<UserRow>(`SELECT ${COLUMNS} FROM users WHERE email = ?`, [
        normaliseEmail(email),
      ]);
      return row && toRecord(row);
    },

    findById(id: string): UserRecord | undefined {
      const row = db.get<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]);
      return row && toRecord(row);
    },

    list(): UserRecord[] {
      return db.all<UserRow>(`SELECT ${COLUMNS} FROM users ORDER BY created_at ASC`).map(toRecord);
    },

    count(): number {
      return db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count ?? 0;
    },

    create(input: { email: string; name: string }): UserRecord {
      const now = new Date().toISOString();
      const id = ulid();

      db.run(
        `INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [id, normaliseEmail(input.email), input.name, now, now],
      );

      return this.findById(id)!;
    },

    update(id: string, patch: { email?: string; name?: string }): UserRecord | undefined {
      const current = this.findById(id);
      if (!current) return undefined;

      db.run(`UPDATE users SET email = ?, name = ?, updated_at = ? WHERE id = ?`, [
        patch.email ? normaliseEmail(patch.email) : current.email,
        patch.name ?? current.name,
        new Date().toISOString(),
        id,
      ]);

      return this.findById(id);
    },

    recordLogin(id: string): void {
      db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [new Date().toISOString(), id]);
    },

    delete(id: string): boolean {
      return db.run("DELETE FROM users WHERE id = ?", [id]).changes > 0;
    },
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;

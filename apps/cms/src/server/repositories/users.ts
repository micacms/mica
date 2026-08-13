/**
 * User repository. Password hashing lives in `services/password.ts`; this
 * module only stores the resulting string.
 */

import type { SqlDatabase } from "../db/driver.js";
import { ulid } from "../lib/id.js";

export type UserRole = "admin" | "editor";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

/** The user shape sent to the browser — never includes the hash. */
export type PublicUser = Omit<UserRecord, "passwordHash">;

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  must_change_password: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function toPublicUser(user: UserRecord): PublicUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

const COLUMNS = `
  id, email, name, password_hash, role, must_change_password,
  created_at, updated_at, last_login_at
`;

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
      return db
        .all<UserRow>(`SELECT ${COLUMNS} FROM users ORDER BY created_at ASC`)
        .map(toRecord);
    },

    count(): number {
      return db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count ?? 0;
    },

    countAdmins(): number {
      return (
        db.get<{ count: number }>("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
          ?.count ?? 0
      );
    },

    create(input: {
      email: string;
      name: string;
      passwordHash: string;
      role: UserRole;
      mustChangePassword?: boolean;
    }): UserRecord {
      const now = new Date().toISOString();
      const id = ulid();
      db.run(
        `INSERT INTO users
           (id, email, name, password_hash, role, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          normaliseEmail(input.email),
          input.name,
          input.passwordHash,
          input.role,
          input.mustChangePassword ? 1 : 0,
          now,
          now,
        ],
      );
      return this.findById(id)!;
    },

    update(
      id: string,
      patch: {
        email?: string;
        name?: string;
        role?: UserRole;
        passwordHash?: string;
        mustChangePassword?: boolean;
      },
    ): UserRecord | undefined {
      const current = this.findById(id);
      if (!current) return undefined;

      db.run(
        `UPDATE users
            SET email = ?, name = ?, role = ?, password_hash = ?,
                must_change_password = ?, updated_at = ?
          WHERE id = ?`,
        [
          patch.email ? normaliseEmail(patch.email) : current.email,
          patch.name ?? current.name,
          patch.role ?? current.role,
          patch.passwordHash ?? current.passwordHash,
          (patch.mustChangePassword ?? current.mustChangePassword) ? 1 : 0,
          new Date().toISOString(),
          id,
        ],
      );
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

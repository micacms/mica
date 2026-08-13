/**
 * SQLite driver.
 *
 * Everything above this file talks to `SqlDatabase`, never to `node:sqlite`
 * directly, so the driver can be swapped (better-sqlite3, libsql, a Postgres
 * adapter) without touching the repositories.
 *
 * `node:sqlite` is the default because it ships with Node — no native build
 * step, no prebuilt-binary mismatch inside the container.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParams = readonly SqlValue[];

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqlDatabase {
  all<T = Record<string, unknown>>(sql: string, params?: SqlParams): T[];
  get<T = Record<string, unknown>>(sql: string, params?: SqlParams): T | undefined;
  run(sql: string, params?: SqlParams): RunResult;
  exec(sql: string): void;
  /** Runs `fn` in a transaction, rolling back if it throws. Safe to nest. */
  transaction<T>(fn: () => T): T;
  /** Consistent on-line snapshot to `destination`, safe while writes continue. */
  snapshot(destination: string): void;
  close(): void;
}

export interface SqliteOptions {
  /** Milliseconds a blocked writer waits before returning SQLITE_BUSY. */
  busyTimeoutMs?: number;
  /** WAL is the right default for a server; `false` is useful for :memory:. */
  wal?: boolean;
}

export function openSqlite(filename: string, options: SqliteOptions = {}): SqlDatabase {
  const db = new DatabaseSync(filename);
  const cache = new Map<string, StatementSync>();
  let depth = 0;

  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000}`);

  if (options.wal !== false) {
    // WAL lets the Astro build read while an editor writes.
    db.exec("PRAGMA journal_mode = WAL");
    // NORMAL is durable across process crashes; only an OS-level crash can lose
    // the last transactions. The right trade-off for a content database.
    db.exec("PRAGMA synchronous = NORMAL");
  }

  const prepare = (sql: string): StatementSync => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };

  // Rows arrive as null-prototype objects; callers expect ordinary ones.
  const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T;

  return {
    all<T>(sql: string, params: SqlParams = []): T[] {
      return prepare(sql)
        .all(...(params as SqlValue[]))
        .map((row) => plain<T>(row));
    },

    get<T>(sql: string, params: SqlParams = []): T | undefined {
      const row = prepare(sql).get(...(params as SqlValue[]));
      return row === undefined ? undefined : plain<T>(row);
    },

    run(sql: string, params: SqlParams = []): RunResult {
      const result = prepare(sql).run(...(params as SqlValue[]));
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid,
      };
    },

    exec(sql: string): void {
      db.exec(sql);
    },

    transaction<T>(fn: () => T): T {
      // Nested calls use savepoints so an inner rollback does not discard the
      // outer transaction's work.
      const name = `sp_${depth}`;
      const begin = depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`;
      const commit = depth === 0 ? "COMMIT" : `RELEASE ${name}`;
      const rollback = depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}`;

      db.exec(begin);
      depth++;
      try {
        const result = fn();
        depth--;
        db.exec(commit);
        return result;
      } catch (error) {
        depth--;
        try {
          db.exec(rollback);
          if (depth > 0) db.exec(`RELEASE ${name}`);
        } catch {
          // The rollback itself failing means the connection is unusable;
          // surface the original error rather than masking it.
        }
        throw error;
      }
    },

    snapshot(destination: string): void {
      // VACUUM INTO takes a read lock only, so editors are not blocked and the
      // resulting file is a defragmented, fully consistent database.
      db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
    },

    close(): void {
      cache.clear();
      db.close();
    },
  };
}

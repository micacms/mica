/**
 * Singleton (global) repository.
 *
 * Globals have no draft state: there is exactly one row per singleton and
 * saving it is publishing it. A missing row simply means "never edited yet",
 * which the service layer turns into schema defaults.
 */

import type { SqlDatabase } from "../db/driver.js";

export interface GlobalRecord {
  name: string;
  data: Record<string, unknown>;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

interface GlobalRow {
  name: string;
  data: string;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

function toRecord(row: GlobalRow): GlobalRecord {
  return {
    name: row.name,
    data: JSON.parse(row.data) as Record<string, unknown>,
    version: row.version,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function createGlobalRepository(db: SqlDatabase) {
  return {
    find(name: string): GlobalRecord | undefined {
      const row = db.get<GlobalRow>(
        "SELECT name, data, version, updated_at, updated_by FROM globals WHERE name = ?",
        [name],
      );
      return row && toRecord(row);
    },

    all(): GlobalRecord[] {
      return db
        .all<GlobalRow>("SELECT name, data, version, updated_at, updated_by FROM globals")
        .map(toRecord);
    },

    save(name: string, data: Record<string, unknown>, userId: string | null): GlobalRecord {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO globals (name, data, version, updated_at, updated_by)
              VALUES (?, ?, 1, ?, ?)
         ON CONFLICT (name) DO UPDATE
              SET data = excluded.data,
                  version = globals.version + 1,
                  updated_at = excluded.updated_at,
                  updated_by = excluded.updated_by`,
        [name, JSON.stringify(data), now, userId],
      );
      return this.find(name)!;
    },
  };
}

export type GlobalRepository = ReturnType<typeof createGlobalRepository>;

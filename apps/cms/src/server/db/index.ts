/**
 * Database bootstrap: open the file, apply migrations, hand back the handle.
 */

import fs from "node:fs";
import path from "node:path";

import { openSqlite, type SqlDatabase, type SqliteOptions } from "./driver.js";
import { migrate } from "./migrations.js";
import type { Logger } from "../lib/logger.js";

export type { SqlDatabase } from "./driver.js";

export interface OpenDatabaseOptions extends SqliteOptions {
  logger?: Logger;
}

export function openDatabase(filename: string, options: OpenDatabaseOptions = {}): SqlDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = openSqlite(filename, options);
  const { applied, currentVersion } = migrate(db);

  if (applied.length > 0) {
    options.logger?.info("Applied database migrations", {
      count: applied.length,
      versions: applied.map((migration) => migration.version),
    });
  }
  options.logger?.debug("Database ready", { filename, schemaVersion: currentVersion });

  return db;
}

/** In-memory database with the full schema — used by the test suite. */
export function openTestDatabase(): SqlDatabase {
  return openDatabase(":memory:", { wal: false });
}

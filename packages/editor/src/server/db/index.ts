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
  /**
   * Say it at debug rather than info.
   *
   * The `npx` front door prints one banner and nothing else, but migrations
   * run before there is anything to put in a banner — so on the first start in
   * a new project, and only then, a database line beat it to the terminal.
   * That is the one start where the first line a person reads matters most.
   *
   * Whoever is reading a container's output still gets it at info.
   */
  quiet?: boolean;
}

export function openDatabase(filename: string, options: OpenDatabaseOptions = {}): SqlDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = openSqlite(filename, options);
  const { applied, currentVersion } = migrate(db, filename);

  if (applied.length > 0 && options.logger) {
    const line = {
      count: applied.length,
      versions: applied.map((migration) => migration.version),
    };

    if (options.quiet) options.logger.debug("Applied database migrations", line);
    else options.logger.info("Applied database migrations", line);
  }
  options.logger?.debug("Database ready", { filename, schemaVersion: currentVersion });

  return db;
}

/** In-memory database with the full schema — used by the test suite. */
export function openTestDatabase(): SqlDatabase {
  return openDatabase(":memory:", { wal: false });
}

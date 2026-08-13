/**
 * Schema migrations.
 *
 * Append-only and numbered: never edit a migration that has shipped, add the
 * next one. Each runs inside a transaction and is recorded in `_migrations`,
 * so the sequence is deterministic across every deployment.
 *
 * Note how little is here. Content, media and their history live in the content
 * repository; this database holds users and sessions. That is the whole point
 * of the Git-native design — losing this file logs everyone out and costs
 * nothing else, and a customer's content model can change without a migration
 * because no table ever described it.
 */

import type { SqlDatabase } from "./driver.js";

export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: `
      CREATE TABLE users (
        id             TEXT PRIMARY KEY,
        email          TEXT NOT NULL,
        name           TEXT NOT NULL DEFAULT '',
        password_hash  TEXT NOT NULL,
        role           TEXT NOT NULL DEFAULT 'editor'
                         CHECK (role IN ('admin', 'editor')),
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        last_login_at  TEXT
      );

      -- Emails are stored lowercased; the index enforces that uniqueness.
      CREATE UNIQUE INDEX users_email_unique ON users (email);

      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,          -- SHA-256 of the cookie token
        user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        csrf_token   TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        ip           TEXT,
        user_agent   TEXT
      );

      CREATE INDEX sessions_user ON sessions (user_id);
      CREATE INDEX sessions_expiry ON sessions (expires_at);

    `,
  },
  {
    version: 2,
    name: "content_moves_to_the_repository",
    up: `
      -- Content, media and revisions now live in the content repository, where
      -- Git provides the persistence, the history and the backup these tables
      -- were standing in for.
      --
      -- Dropped rather than left in place, because a table nobody writes is a
      -- table someone will eventually read. Anything still in them is exported
      -- by \`pnpm cms:export-content\`, which must be run *before* this applies.
      DROP TABLE IF EXISTS revisions;
      DROP TABLE IF EXISTS media;
      DROP TABLE IF EXISTS globals;
      DROP TABLE IF EXISTS entries;
    `,
  },
];

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

export interface MigrationResult {
  applied: Migration[];
  currentVersion: number;
}

/** The migration an open database has reached. Reported by the system page. */
export function databaseVersion(db: SqlDatabase): number {
  return db.get<{ version: number | null }>("SELECT MAX(version) AS version FROM _migrations")
    ?.version ?? 0;
}

export function migrate(db: SqlDatabase): MigrationResult {
  db.exec(MIGRATIONS_TABLE);

  const rows = db.all<{ version: number }>("SELECT version FROM _migrations ORDER BY version");
  const done = new Set(rows.map((row) => row.version));
  const applied: Migration[] = [];

  const ordered = [...migrations].sort((a, b) => a.version - b.version);

  // A migration recorded in the database but absent from the code means the
  // deployment was rolled back to an older build; refuse rather than corrupt.
  const known = new Set(ordered.map((migration) => migration.version));
  for (const version of done) {
    if (!known.has(version)) {
      throw new Error(
        `Database is at migration ${version}, which this build does not know about. ` +
          `Deploy a newer version of the CMS, or restore a matching backup.`,
      );
    }
  }

  for (const migration of ordered) {
    if (done.has(migration.version)) continue;

    db.transaction(() => {
      db.exec(migration.up);
      db.run("INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)", [
        migration.version,
        migration.name,
        new Date().toISOString(),
      ]);
    });

    applied.push(migration);
  }

  const currentVersion = ordered.at(-1)?.version ?? 0;
  return { applied, currentVersion };
}

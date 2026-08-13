/**
 * Schema migrations.
 *
 * Append-only and numbered: never edit a migration that has shipped, add the
 * next one. Each runs inside a transaction and is recorded in `_migrations`,
 * so the sequence is deterministic across every deployment.
 *
 * Note what is *not* here: per-collection tables. Content lives as JSON in
 * `entries.data`, validated against the shared model, so changing a customer's
 * content model never requires a migration.
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

      CREATE TABLE entries (
        id           TEXT PRIMARY KEY,
        collection   TEXT NOT NULL,
        slug         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'published')),
        position     INTEGER NOT NULL DEFAULT 0,
        data         TEXT NOT NULL DEFAULT '{}'
                       CHECK (json_valid(data)),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        published_at TEXT,
        version      INTEGER NOT NULL DEFAULT 1,
        created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
        updated_by   TEXT REFERENCES users (id) ON DELETE SET NULL
      );

      CREATE UNIQUE INDEX entries_collection_slug ON entries (collection, slug);
      CREATE INDEX entries_collection_status ON entries (collection, status);
      CREATE INDEX entries_collection_position ON entries (collection, position);
      CREATE INDEX entries_published ON entries (collection, published_at DESC);

      CREATE TABLE globals (
        name       TEXT PRIMARY KEY,
        data       TEXT NOT NULL DEFAULT '{}'
                     CHECK (json_valid(data)),
        version    INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        updated_by TEXT REFERENCES users (id) ON DELETE SET NULL
      );

      CREATE TABLE media (
        id          TEXT PRIMARY KEY,
        filename    TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        width       INTEGER,
        height      INTEGER,
        size        INTEGER NOT NULL,
        alt_text    TEXT NOT NULL DEFAULT '',
        checksum    TEXT,
        created_at  TEXT NOT NULL,
        created_by  TEXT REFERENCES users (id) ON DELETE SET NULL
      );

      CREATE INDEX media_created ON media (created_at DESC);
      CREATE INDEX media_checksum ON media (checksum);

      CREATE TABLE revisions (
        id          TEXT PRIMARY KEY,
        target_type TEXT NOT NULL CHECK (target_type IN ('entry', 'global')),
        target_id   TEXT NOT NULL,             -- entry id, or global name
        collection  TEXT,                      -- null for globals
        version     INTEGER NOT NULL,
        slug        TEXT,
        status      TEXT,
        title       TEXT NOT NULL DEFAULT '',
        data        TEXT NOT NULL CHECK (json_valid(data)),
        note        TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        created_by  TEXT REFERENCES users (id) ON DELETE SET NULL
      );

      CREATE INDEX revisions_target ON revisions (target_type, target_id, created_at DESC);
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

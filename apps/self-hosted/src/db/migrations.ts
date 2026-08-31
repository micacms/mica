/**
 * Schema migrations.
 *
 * Append-only and numbered: never edit a migration that has shipped, add the
 * next one. Each runs inside a transaction and is recorded in `_migrations`,
 * so the sequence is deterministic across every deployment.
 *
 * The chain was reset once, for 0.2.0, and this is the migration it was reset
 * to. The four it replaced built accounts, tenants, sites and memberships,
 * all dropped in that release — a fifth migration would have been three
 * quarters `DROP TABLE`. No deployment existed to carry forward, which is
 * the only condition under which the append-only rule may be broken. It
 * applies again from here.
 *
 * Note how little is left. Content, media and their history live in the content
 * repository; this database holds sessions, and later the drafts that have not
 * been published yet. A customer's content model can change without a migration
 * because no table ever described it.
 */

import type { SqlDatabase } from "@micacms/runtime";

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
      -- One table, and it is not a user table.
      --
      -- Mica stores no accounts. An identity provider says who somebody is,
      -- and configuration says whether that person may edit this site; what
      -- is left to store is the browser session in between, which nothing
      -- else can hold for us.
      --
      -- The claims are copied onto the row because admission is re-checked on
      -- every request, and asking the provider again on every request is not
      -- something a provider would thank us for. They are a snapshot: a group
      -- removed at the provider is seen at the next sign-in, which is why
      -- sessions are hours rather than weeks.
      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,          -- SHA-256 of the cookie token
        -- Who this is, as the provider stated it. Null in local mode, where
        -- there is no provider, no user and nobody to ask: the row exists
        -- there only to carry the CSRF token.
        issuer       TEXT,
        subject      TEXT,
        email        TEXT,
        -- Whether the provider says it has verified that address. The domain
        -- rule refuses without it: a provider that lets anybody self-register
        -- would otherwise let anybody claim an admitted domain.
        email_verified INTEGER NOT NULL DEFAULT 0,
        name         TEXT,
        -- The groups claim, as a JSON array. Never trusted to be one: it is
        -- read defensively, because it comes from outside.
        groups       TEXT NOT NULL DEFAULT '[]',
        csrf_token   TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        ip           TEXT,
        user_agent   TEXT
      );

      CREATE INDEX sessions_expiry ON sessions (expires_at);

      -- Signing one person out everywhere, which is what a removed editor
      -- needs and the only reason to look a session up by anything but its id.
      CREATE INDEX sessions_identity ON sessions (issuer, subject);
    `,
  },
  {
    version: 2,
    name: "draft_store",
    up: `
      -- The self-hosted draft store: work that is saved and not yet published.
      --
      -- This is SQLite's second job, and it changes what losing this database
      -- costs. It used to cost sign-ins and nothing else; from here it costs
      -- unpublished work, which Git is not protecting yet. The self-hosted
      -- backup guidance says so.
      --
      -- A flat map of file paths, deliberately. Not entries, not revisions,
      -- not history — Git is the history, and a successful publication clears
      -- what it published. One row per path: the pending state of that file,
      -- and the repository revision it had when it was first staged, which is
      -- the per-path publish gate.
      CREATE TABLE drafts (
        path          TEXT PRIMARY KEY,
        kind          TEXT NOT NULL CHECK (kind IN ('write', 'delete')),
        -- The staged bytes. Null for a deletion.
        contents      BLOB,
        -- Whether the bytes were staged as text, so a publication can send
        -- them as text and keep the provider's diff readable.
        is_text       INTEGER NOT NULL DEFAULT 0,
        -- Null asserts the path was absent from the repository when staged.
        base_revision TEXT,
        -- Monotonic across the store; re-staging a path bumps it. Publication
        -- clears rows by (path, version), which is how an autosave that lands
        -- mid-publish survives.
        version       INTEGER NOT NULL,
        updated_at    TEXT NOT NULL
      );

      -- The branch head the pending draft began from. Display only: the
      -- publish gate is per path, so this is one row of context, not a lock.
      CREATE TABLE draft_base (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        revision    TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
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

export function migrate(db: SqlDatabase, filename?: string): MigrationResult {
  db.exec(MIGRATIONS_TABLE);

  const rows = db.all<{ version: number }>("SELECT version FROM _migrations ORDER BY version");
  const done = new Set(rows.map((row) => row.version));
  const applied: Migration[] = [];

  const ordered = [...migrations].sort((a, b) => a.version - b.version);

  /**
   * A migration recorded in the database but absent from the code means one of
   * two things: the deployment was rolled back to an older build, or the file
   * predates the 0.2.0 reset. Refuse either way rather than writing into a shape
   * this build does not understand — and say what it costs to start again,
   * because for this database it costs very little.
   */
  const known = new Set(ordered.map((migration) => migration.version));
  for (const version of done) {
    if (!known.has(version)) {
      throw new Error(
        `Database is at migration ${version}, which this build does not know about.\n` +
          "  Either this is an older build than the database, or the file predates Mica 0.2.0.\n" +
          "  This database holds sessions and nothing else — no content, no accounts — so\n" +
          `  deleting ${filename ?? "it"} signs everyone out and costs nothing more.`,
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

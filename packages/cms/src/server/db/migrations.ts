/**
 * Schema migrations.
 *
 * Append-only and numbered: never edit a migration that has shipped, add the
 * next one. Each runs inside a transaction and is recorded in `_migrations`,
 * so the sequence is deterministic across every deployment.
 *
 * All three below are older than the first release. They are kept as a sequence
 * rather than folded into one because folding them would renumber the chain,
 * and `migrate()` refuses to open a database that has reached a version this
 * build does not know about — which is the right refusal, and the reason the
 * rule above exists.
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
      -- table someone will eventually read. No released version of Mica ever
      -- wrote them, so there is nothing here to export first — on a fresh
      -- database all four DROPs are no-ops.
      DROP TABLE IF EXISTS revisions;
      DROP TABLE IF EXISTS media;
      DROP TABLE IF EXISTS globals;
      DROP TABLE IF EXISTS entries;
    `,
  },
  {
    version: 3,
    name: "tenants_sites_and_federated_identity",
    up: `
      -- Two changes that only look like one.
      --
      -- Identity leaves Mica. There is no password column any more, because
      -- there is no password: an identity provider vouches for a person and
      -- Mica records who that person is. Everything a password brings with it —
      -- reset flows, MFA, passkeys, breach notification — is now somebody
      -- else's job, and that is the point.
      --
      -- Authorization becomes a membership. A role is not a property of a
      -- person; it is a property of a person *on a site*. Storing it on the
      -- user was only correct while there could never be more than one site.

      CREATE TABLE tenants (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE sites (
        id         TEXT PRIMARY KEY,
        tenant_id  TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
        -- Stable, URL-safe, and unique within the deployment: it is what a
        -- future /sites/:slug route would address.
        slug       TEXT NOT NULL,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX sites_slug_unique ON sites (slug);
      CREATE INDEX sites_tenant ON sites (tenant_id);

      -- How one site reaches its content repository. One row per site: a site
      -- is a repository, and a second connection would mean a second site.
      --
      -- The token is stored as given. Mica does not implement a secret store —
      -- encrypting it with a key sitting in the same environment would be
      -- theatre. Protect this file the way you protect any credential store,
      -- or keep the token in the environment and leave this column null.
      CREATE TABLE repository_connections (
        site_id    TEXT PRIMARY KEY REFERENCES sites (id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('local', 'github', 'gitlab')),
        project    TEXT,
        branch     TEXT NOT NULL DEFAULT 'main',
        root       TEXT NOT NULL DEFAULT 'content',
        api_base   TEXT,
        token      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE memberships (
        id         TEXT PRIMARY KEY,
        site_id    TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX memberships_unique ON memberships (site_id, user_id);
      CREATE INDEX memberships_user ON memberships (user_id);

      -- The mapping from an identity provider's subject to a Mica user.
      --
      -- Keyed by (issuer, subject) rather than by email, because an email
      -- address is a display attribute an IdP may let a person change, and
      -- rebinding an account to whoever holds an address today is how account
      -- takeover happens.
      CREATE TABLE oidc_identities (
        issuer     TEXT NOT NULL,
        subject    TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (issuer, subject)
      );

      CREATE INDEX oidc_identities_user ON oidc_identities (user_id);

      /* ---------------------------------------------------------------- */

      -- Rebuild users without the password columns. SQLite can drop a column
      -- in place, but recreating states the intended shape in one place rather
      -- than leaving the reader to replay four ALTERs.
      CREATE TABLE users_new (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL,
        name          TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        last_login_at TEXT
      );

      INSERT INTO users_new (id, email, name, created_at, updated_at, last_login_at)
        SELECT id, email, name, created_at, updated_at, last_login_at FROM users;

      -- A default tenant and site, so an existing deployment keeps working and
      -- a single-site operator never meets the concept. Fixed ids: they are the
      -- ones the server looks for when no site is named.
      INSERT INTO tenants (id, name, created_at)
        VALUES ('default', 'Default', datetime('now'));

      INSERT INTO sites (id, tenant_id, slug, name, created_at)
        VALUES ('default', 'default', 'default', 'Default site', datetime('now'));

      -- Existing accounts keep the role they had, now against that site.
      INSERT INTO memberships (id, site_id, user_id, role, created_at)
        SELECT lower(hex(randomblob(16))), 'default', id, role, datetime('now')
        FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE UNIQUE INDEX users_email_unique ON users (email);

      -- Every existing session is now unauthenticated: the credential that
      -- established it no longer exists, so honouring it would be honouring a
      -- password check that can never be repeated.
      DELETE FROM sessions;
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

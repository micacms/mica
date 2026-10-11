/**
 * Test harness: the complete self-hosted composition against an in-memory
 * database and a temporary content directory.
 *
 * Built exactly the way `src/index.ts` builds it — the runtime behind the
 * OIDC gate — so what these tests exercise is the composition itself:
 * sessions, admission, CSRF, and the SQLite draft store behind a
 * provider-shaped configuration.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOidcAuth, type OidcAuth, type SessionIdentity } from "@micacms/auth-oidc";
import { localConnector } from "@micacms/connectors";
import {
  collection,
  defineSite,
  media,
  number,
  relation,
  richText,
  select,
  singleton,
  slug,
  text,
  type Site,
} from "@micacms/core";
import {
  createApp,
  createLogger,
  createRuntimeContext,
  type RuntimeContext,
} from "@micacms/runtime";

import { loadConfig, type SelfHostedConfig } from "../src/config.js";
import { createDraftRepository } from "../src/db/drafts.js";
import { openTestDatabase } from "../src/db/index.js";
import { databaseVersion } from "../src/db/migrations.js";
import type { SqlDatabase } from "@micacms/runtime";

export const TEST_ORIGIN = "http://localhost:6422";
export const ISSUER = "https://id.example.test";

/** A deliberately small model, so assertions stay readable. */
export const testSite = defineSite({
  collections: {
    projects: collection({
      label: "Projects",
      sortable: true,
      fields: {
        title: text({ label: "Title", required: true, maxLength: 50, listed: true }),
        slug: slug({ from: "title" }),
        year: number({ integer: true, min: 1900 }),
        summary: richText(),
        category: select({
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
        }),
        cover: media({ accept: "image" }),
        gallery: media({ multiple: true, accept: "image" }),
        lead: relation({ collection: "team" }),
      },
    }),
    team: collection({
      label: "Team",
      fields: {
        name: text({ label: "Name", required: true }),
        slug: slug({ from: "name" }),
      },
    }),
  },
  singletons: {
    settings: singleton({
      label: "Website",
      fields: {
        siteName: text({ label: "Site name" }),
        tagline: text({ label: "Tagline" }),
      },
    }),
  },
});

/** The claims a provider would return for somebody the rules let in. */
export const ADMITTED: SessionIdentity = {
  issuer: ISSUER,
  subject: "admitted-subject",
  email: "editor@example.com",
  emailVerified: true,
  name: "Ed Editor",
  groups: ["mica-editors"],
};

/** Authenticates perfectly well, and is in no group and no list. */
export const REFUSED: SessionIdentity = {
  issuer: ISSUER,
  subject: "refused-subject",
  email: "mallory@elsewhere.example",
  emailVerified: true,
  name: "Mallory",
  groups: ["everyone"],
};

export interface Session {
  cookie: string;
  csrfToken: string;
}

export interface TestHarness {
  ctx: RuntimeContext;
  config: SelfHostedConfig;
  auth: OidcAuth;
  db: SqlDatabase;
  /** The temporary content directory, so a test can assert on the files. */
  contentRoot: string;
  /** Issues a request; `session` carries cookies and the CSRF token. */
  request(path: string, init?: RequestInit & { session?: Session }): Promise<Response>;
  /**
   * Starts a session without an identity provider round trip.
   *
   * Nothing below the session cookie cares how the cookie was obtained, so
   * the admission tests do not need a fake provider to be meaningful: they
   * state the claims a provider would have returned and go from there.
   */
  signIn(identity?: SessionIdentity): Promise<Session>;
  close(): Promise<void>;
}

export async function createHarness(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  options: { site?: Site; adminDir?: string } = {},
): Promise<TestHarness> {
  const contentRoot = mkdtempSync(join(tmpdir(), "mica-test-content-"));

  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MICA_PUBLIC_URL: TEST_ORIGIN,
    SESSION_SECRET: "0".repeat(32),
    DATA_DIR: "/tmp/mica-test-unused",
    CONTENT_ROOT: contentRoot,
    MICA_OIDC_ISSUER: ISSUER,
    MICA_OIDC_CLIENT_ID: "mica",
    MICA_ADMIT_GROUP: "mica-editors",
    // Provider-shaped, as every self-hosted deployment is. The local connector
    // stands in as "the provider", so the temporary directory is the repository.
    REPOSITORY: "github",
    REPOSITORY_PROJECT: "acme/site",
    REPOSITORY_TOKEN: "unused-by-the-test-connector",
    ...overrides,
  } as NodeJS.ProcessEnv);

  const logger = createLogger({ level: "silent", pretty: false });
  const db = openTestDatabase();
  const connector = localConnector({ root: contentRoot });
  const auth = createOidcAuth({ config, logger });

  const drafts = createDraftRepository(db);

  const ctx = createRuntimeContext({
    config,
    model: options.site ?? testSite,
    connector,
    drafts,
    logger,
    operational: () => ({
      auth: `oidc:${new URL(ISSUER).hostname}`,
      admission: auth.admission.summary,
      database: {
        path: config.databasePath,
        version: databaseVersion(db),
        bytes: null,
      },
      dataDir: config.dataDir,
      sessionTtlHours: config.SESSION_TTL_HOURS,
      sessionIdleHours: config.SESSION_IDLE_HOURS,
      generatedSecrets: config.devSecrets,
    }),
    health: { database: () => void db.get("SELECT 1 AS ok") },
    onShutdown: () => {
      auth.loginLimiter.stop();
      db.close();
    },
  });

  // No admin build in the test tree; point at a directory that cannot exist.
  const app = createApp(ctx, {
    auth: auth.surface,
    adminDir: options.adminDir ?? "/nonexistent",
  });

  return {
    ctx,
    config,
    auth,
    db,
    contentRoot,

    async request(path, init = {}) {
      const { session, ...rest } = init;
      const headers = new Headers(rest.headers);

      // A browser sets Origin on writes; the origin guard requires it.
      if (!headers.has("origin") && rest.method && rest.method !== "GET") {
        headers.set("origin", TEST_ORIGIN);
      }
      if (session) {
        headers.set("cookie", session.cookie);
        headers.set("x-csrf-token", session.csrfToken);
      }

      return app.request(`${TEST_ORIGIN}${path}`, { ...rest, headers });
    },

    async signIn(identity: SessionIdentity = ADMITTED) {
      const { record, cookie } = auth.sessions.create(identity);

      return {
        cookie: `${auth.sessions.names.session}=${cookie}; ${auth.sessions.names.csrf}=${record.csrfToken}`,
        csrfToken: record.csrfToken,
      };
    },

    async close() {
      await ctx.shutdown();
      rmSync(contentRoot, { recursive: true, force: true });
    },
  };
}

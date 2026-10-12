/**
 * Test harness: the self-hosted composition against a temporary data
 * directory whose `repository/` is a plain Git repository.
 *
 * Built the way `src/index.ts` builds it — the runtime behind the OIDC gate,
 * on a working tree in the data directory — so what these tests exercise is
 * the composition itself: sessions, admission and CSRF. The clone, its sync
 * and its publications are `managed.test.ts`'s, against a real Git host.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  /** The content root in the data directory's repository, so a test can assert on the files. */
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
  const dataDir = mkdtempSync(join(tmpdir(), "mica-test-data-"));

  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MICA_PUBLIC_URL: TEST_ORIGIN,
    SESSION_SECRET: "0".repeat(32),
    MICA_DATA_DIR: dataDir,
    MICA_REPOSITORY_URL: "https://git.example.test/acme/site.git",
    MICA_REPOSITORY_TOKEN: "unused-by-the-harness",
    MICA_OIDC_ISSUER: ISSUER,
    MICA_OIDC_CLIENT_ID: "mica",
    MICA_ADMIT_GROUP: "mica-editors",
    ...overrides,
  } as NodeJS.ProcessEnv);

  // The data directory's repository, without a remote: the harness never syncs.
  const contentRoot = config.contentRoot;
  mkdirSync(contentRoot, { recursive: true });
  execFileSync("git", ["init", "--quiet", join(dataDir, "repository")]);

  const logger = createLogger({ level: "silent", pretty: false });
  const connector = localConnector({ root: contentRoot });
  const auth = createOidcAuth({ config, logger });

  const ctx = createRuntimeContext({
    config,
    model: options.site ?? testSite,
    connector,
    logger,
    operational: () => ({
      auth: `oidc:${new URL(ISSUER).hostname}`,
      admission: auth.admission.summary,
      database: null,
      dataDir: config.dataDir,
      sessionTtlHours: config.SESSION_TTL_HOURS,
      sessionIdleHours: config.SESSION_IDLE_HOURS,
      generatedSecrets: config.devSecrets,
    }),
    health: { ready: () => ({ ok: true, reasons: [] }) },
    onShutdown: () => {
      auth.loginLimiter.stop();
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
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

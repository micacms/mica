/**
 * Test harness: a complete application against an in-memory database and a
 * temporary content directory.
 *
 * The content directory is real, and deliberately so. The store's whole job is
 * what it does to a repository, and a fake connector would let a test pass
 * while the files came out wrong. Each harness gets its own directory and
 * removes it on `close`, so there is no shared state between tests.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { localConnector } from "@micacms/connectors";

import { collection, defineSite, media, number, relation, richText, select, singleton, slug, text, type Site } from "@micacms/model";

import { createApp } from "../src/server/app.js";
import { loadConfig, type Config } from "../src/server/config.js";
import { DEFAULT_SITE_ID } from "../src/server/repositories/sites.js";
import { createContext, type AppContext } from "../src/server/context.js";
import { openTestDatabase } from "../src/server/db/index.js";
import { createLogger } from "../src/server/lib/logger.js";

export const TEST_ORIGIN = "http://localhost:6422";

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
    // File layout: no rich text and no media, so this is one JSON document.
    settings: singleton({
      label: "Website",
      fields: {
        siteName: text({ label: "Site name" }),
        tagline: text({ label: "Tagline" }),
      },
    }),
  },
});

export interface TestHarness {
  ctx: AppContext;
  config: Config;
  /** The temporary content directory, so a test can assert on the files. */
  contentRoot: string;
  /** Issues a request; `session` carries cookies and the CSRF token. */
  request(path: string, init?: RequestInit & { session?: Session }): Promise<Response>;
  /**
   * Signs in without an identity provider.
   *
   * The tests exercise `MICA_MODE=local`, where there is no OIDC round trip to
   * make — which is the point: nothing below the session cookie cares how the
   * cookie was obtained, so the authorization tests do not need a fake IdP to
   * be meaningful.
   */
  signIn(email?: string): Promise<Session>;
  /** Records that this person may edit the test site. */
  addMember(input: { email: string; role?: "admin" | "editor" }): string;
  close(): Promise<void>;
}

export interface Session {
  cookie: string;
  csrfToken: string;
}

export const ADMIN_EMAIL = "admin@example.com";

export async function createHarness(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  // The model is normally `testSite`; a test overrides it to check what the
  // server does when two deployments disagree about the content model.
  //
  // `adminDir` is for the few tests that care about the admin page itself
  // rather than the API — serving it is where local mode signs somebody in.
  options: { site?: Site; adminDir?: string } = {},
): Promise<TestHarness> {
  const contentRoot = mkdtempSync(join(tmpdir(), "mica-test-content-"));

  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    CMS_BASE_URL: TEST_ORIGIN,
    SESSION_SECRET: "0".repeat(32),
    DATA_DIR: "/tmp/mica-test-unused",
    CONTENT_ROOT: contentRoot,
    ...overrides,
  } as NodeJS.ProcessEnv);

  const ctx = createContext({
    config,
    site: options.site ?? testSite,
    db: openTestDatabase(),
    connector: localConnector({ root: contentRoot }),
    logger: createLogger({ level: "silent", pretty: false }),
  });

  // No admin build in the test tree; point at a directory that cannot exist.
  const app = createApp(ctx, { adminDir: options.adminDir ?? "/nonexistent" });

  const harness: TestHarness = {
    ctx,
    config,
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

    async signIn(email = ADMIN_EMAIL) {
      const user = ctx.repositories.users.findByEmail(email);
      if (!user) throw new Error(`No such user: ${email}. Call addMember first.`);

      const { cookie, csrfToken } = ctx.services.sessions.create({
        userId: user.id,
        ip: "127.0.0.1",
        userAgent: "test",
      });

      return {
        cookie: `mica_session=${cookie}; mica_csrf=${csrfToken}`,
        csrfToken,
      };
    },

    addMember({ email, role = "admin" }) {
      const user =
        ctx.repositories.users.findByEmail(email) ??
        ctx.repositories.users.create({ email, name: email.split("@")[0]! });

      ctx.repositories.memberships.grant({ siteId: DEFAULT_SITE_ID, userId: user.id, role });
      return user.id;
    },

    async close() {
      await ctx.shutdown();
      rmSync(contentRoot, { recursive: true, force: true });
    },
  };

  harness.addMember({ email: ADMIN_EMAIL, role: "admin" });
  return harness;
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** A real 1×1 PNG, so content sniffing and dimension reading see valid bytes. */
export function pngBytes(): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.from([0x00, 0x00, 0x00, 0x00]))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function multipart(files: Array<{ name: string; bytes: Uint8Array; type: string }>): FormData {
  const form = new FormData();
  for (const file of files) {
    form.append("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
  }
  return form;
}

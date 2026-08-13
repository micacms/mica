/**
 * Test harness: a complete application against an in-memory database, in-memory
 * media storage and a recording publisher. No filesystem, no network, no
 * shared state between tests.
 */

import { deflateSync } from "node:zlib";

import { collection, defineSite, media, number, relation, richText, select, singleton, slug, text, type Site } from "@micacms/model";

import { createApp } from "../src/server/app.js";
import { loadConfig, type Config } from "../src/server/config.js";
import { createContext, type AppContext } from "../src/server/context.js";
import { openTestDatabase } from "../src/server/db/index.js";
import { createLogger } from "../src/server/lib/logger.js";
import { hashPassword } from "../src/server/services/password.js";
import type { PublishEvent, Publisher } from "../src/server/services/publisher.js";
import { memoryStorage } from "../src/server/services/storage.js";

export const TEST_ORIGIN = "http://localhost:4000";

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
    site: singleton({
      label: "Website",
      fields: {
        companyName: text({ label: "Company name", required: true }),
        logo: media({ accept: "image" }),
      },
    }),
  },
});

export interface RecordingPublisher extends Publisher {
  events: PublishEvent[];
}

function recordingPublisher(): RecordingPublisher {
  const events: PublishEvent[] = [];
  return {
    events,
    async publish(event) {
      events.push(event);
    },
    async flush() {},
    status() {
      return {
        pending: 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
        configured: true,
      };
    },
  };
}

export interface TestHarness {
  ctx: AppContext;
  publisher: RecordingPublisher;
  config: Config;
  /** Issues a request; `session` carries cookies and the CSRF token. */
  request(path: string, init?: RequestInit & { session?: Session }): Promise<Response>;
  signIn(email?: string, password?: string): Promise<Session>;
  createUser(input: {
    email: string;
    password: string;
    role?: "admin" | "editor";
  }): Promise<void>;
  close(): Promise<void>;
}

export interface Session {
  cookie: string;
  csrfToken: string;
}

export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "correct-horse-battery";

export async function createHarness(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  // The model is normally `testSite`; a test overrides it to check what the
  // server does when two deployments disagree about the content model.
  options: { site?: Site } = {},
): Promise<TestHarness> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    CMS_BASE_URL: TEST_ORIGIN,
    SESSION_SECRET: "0".repeat(32),
    CMS_READ_TOKEN: "test-read-token-0123456789",
    DATA_DIR: "/tmp/mica-test-unused",
    ...overrides,
  } as NodeJS.ProcessEnv);

  const publisher = recordingPublisher();

  const ctx = createContext({
    config,
    site: options.site ?? testSite,
    db: openTestDatabase(),
    storage: memoryStorage(),
    publisher,
    logger: createLogger({ level: "silent", pretty: false }),
  });

  // No admin build in the test tree; point at a directory that cannot exist.
  const app = createApp(ctx, { adminDir: "/nonexistent" });

  const harness: TestHarness = {
    ctx,
    publisher,
    config,

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

    async signIn(email = ADMIN_EMAIL, password = ADMIN_PASSWORD) {
      const response = await harness.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error(`Sign-in failed: ${response.status} ${await response.text()}`);
      }

      const body = (await response.json()) as { csrfToken: string };
      const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]!);

      return { cookie: cookies.join("; "), csrfToken: body.csrfToken };
    },

    async createUser({ email, password, role = "admin" }) {
      ctx.repositories.users.create({
        email,
        name: email.split("@")[0]!,
        role,
        passwordHash: await hashPassword(password),
      });
    },

    async close() {
      await ctx.shutdown();
    },
  };

  await harness.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: "admin" });
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

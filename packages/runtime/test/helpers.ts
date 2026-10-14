/**
 * Test harness: the runtime as the local editor composes it, on a real
 * temporary content directory.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { contentFiles } from "../src/index.js";
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
} from "@micacms/core/internal";

import { createApp } from "../src/app.js";
import { createRuntimeContext, type RuntimeContext } from "../src/context.js";
import type { RuntimeConfig } from "../src/config.js";
import { createLogger, type Logger } from "../src/lib/logger.js";

export const TEST_ORIGIN = "http://localhost:6422";

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
    // No rich text and no media, so this is one JSON file.
    settings: singleton({
      label: "Website",
      fields: {
        siteName: text({ label: "Site name" }),
        tagline: text({ label: "Tagline" }),
      },
    }),
  },
});

export function testConfig(
  contentRoot: string,
  overrides: Partial<RuntimeConfig> = {},
): RuntimeConfig {
  return {
    MICA_LOG_LEVEL: "silent",
    HOST: "127.0.0.1",
    PORT: 6422,
    MICA_PUBLIC_URL: TEST_ORIGIN,
    MICA_CONTENT_ROOT: contentRoot,
    MICA_LOCAL_PUBLISH: true,
    MICA_MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
    MICA_TRUST_PROXY: false,
    isLoopback: true,
    contentRoot,
    adminOrigins: [],
    ...overrides,
  };
}

export interface TestHarness {
  ctx: RuntimeContext;
  contentRoot: string;
  request(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function createHarness(
  overrides: Partial<RuntimeConfig> = {},
  options: { site?: Site; logger?: Logger } = {},
): Promise<TestHarness> {
  const contentRoot = mkdtempSync(join(tmpdir(), "mica-runtime-test-"));
  const config = testConfig(contentRoot, overrides);

  const ctx = createRuntimeContext({
    config,
    model: options.site ?? testSite,
    files: contentFiles({ root: contentRoot }),
    logger: options.logger ?? createLogger({ level: "silent", pretty: false }),
    operational: () => ({ auth: "none — test harness" }),
  });

  const app = createApp(ctx);

  return {
    ctx,
    contentRoot,

    async request(path, init = {}) {
      const headers = new Headers(init.headers);

      // A browser sets Origin on writes; the origin guard checks it.
      if (!headers.has("origin") && init.method && init.method !== "GET") {
        headers.set("origin", TEST_ORIGIN);
      }

      return app.request(`${TEST_ORIGIN}${path}`, { ...init, headers });
    },

    async close() {
      await ctx.shutdown();
      rmSync(contentRoot, { recursive: true, force: true });
    },
  };
}

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

export function multipart(
  files: Array<{ name: string; bytes: Uint8Array; type: string }>,
): FormData {
  const form = new FormData();
  for (const file of files) {
    form.append("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  }
  return form;
}

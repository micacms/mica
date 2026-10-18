/**
 * The reload budget at the 1.0 target (#236): the loader reads a collection of
 * 1,000 entries with rich text in a few seconds, as `astro dev` does after a change.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, richText, slug, text } from "@micacms/core/internal";

import { micaCollections } from "../src/index.js";

const ENTRIES = 1_000;

const site = defineSite({
  root: "./content",
  collections: {
    news: collection({ label: "News", fields: { title: text(), slug: slug({ from: "title" }), body: richText() } }),
  },
});

let dir = "";
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "mica-astro-budget-"));
  for (let index = 0; index < ENTRIES; index++) {
    const folder = join(dir, "content", "news", `news-${index}`);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "index.json"), JSON.stringify({ title: `News ${index}`, slug: `news-${index}` }));
    await writeFile(join(folder, "body.mdoc"), `Text of news ${index}, with a [link](/news/).\n`);
  }
});
after(() => rm(dir, { recursive: true, force: true }));

describe("the reload budget", () => {
  it(`loads ${ENTRIES} entries with rich text in a few seconds`, async () => {
    const entries = new Map<string, unknown>();
    const start = performance.now();
    await micaCollections(site, { publishModel: false }).news.loader.load({
      config: { root: pathToFileURL(dir + sep) },
      store: {
        clear: () => entries.clear(),
        set: ({ id, data }) => (entries.set(id, data), true),
        keys: () => [...entries.keys()],
      },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      meta: { get: () => undefined, set: () => {} },
      parseData: async ({ data }) => data,
      generateDigest: () => "digest",
    });
    const ms = performance.now() - start;
    assert.equal(entries.size, ENTRIES);
    assert.ok(ms < 5_000, `${ms} ms`);
  });
});

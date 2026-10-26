/**
 * The content root: where it comes from, and how it is resolved.
 *
 * One string, stated in `defineSite({ root })`, has to mean the same directory
 * wherever it is read — and it has to mean it whatever the working directory
 * happens to be. A wrong root produces an empty build rather than an error,
 * which is the failure worth guarding.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import { collection, createManifest, defineSite, id, text } from "@micacms/core/internal";

import { DEFAULT_CONTENT_ROOT, micaCollections, resolveContentRoot } from "../src/index.js";

const projectRoot = pathToFileURL(join(tmpdir(), "a-project") + sep);

describe("resolveContentRoot", () => {
  it("resolves a relative root against the Astro project, not the process", () => {
    assert.equal(
      resolveContentRoot("./content", projectRoot),
      join(tmpdir(), "a-project", "content"),
    );
  });

  it("accepts a root outside the project", () => {
    assert.equal(
      resolveContentRoot("../shared/content", projectRoot),
      join(tmpdir(), "shared", "content"),
    );
  });

  it("leaves an absolute root alone — content checked out somewhere else by CI", () => {
    assert.equal(resolveContentRoot("/srv/checkout/content", projectRoot), "/srv/checkout/content");
  });

  it("falls back to the working directory when there is no project root", () => {
    assert.equal(resolveContentRoot("./content"), resolve("./content"));
  });

  it("defaults to ./content", () => {
    assert.equal(resolveContentRoot(undefined, projectRoot), join(tmpdir(), "a-project", "content"));
    assert.equal(DEFAULT_CONTENT_ROOT, "./content");
  });

  it("survives a project root given without a trailing slash", () => {
    const noSlash = new URL(pathToFileURL(join(tmpdir(), "a-project")).href);
    assert.equal(resolveContentRoot("./content", noSlash), join(tmpdir(), "a-project", "content"));
  });
});

/* ------------------------------------------------------------------ */

const site = defineSite({
  root: "./content",
  collections: {
    news: collection({ label: "News", fields: { title: text(), id: id({ from: "title" }) } }),
  },
});

describe("the root comes from the model", () => {
  it("is where the loaders read, resolved against the project Astro reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mica-root-"));

    try {
      await mkdir(join(dir, "content", "news", "hello"), { recursive: true });
      await writeFile(
        join(dir, "content", "news", "hello", "index.json"),
        JSON.stringify({ title: "Hello", id: "hello" }),
      );

      const collections = micaCollections(site, { publishModel: false });
      const entries = new Map<string, Record<string, unknown>>();

      await collections.news.loader.load({
        // The one thing the loader needs to turn "./content" into a directory.
        config: { root: pathToFileURL(dir + sep) },
        store: {
          clear: () => entries.clear(),
          set: ({ id, data }) => {
            entries.set(id, data);
            return true;
          },
          keys: () => [...entries.keys()],
        },
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        meta: { get: () => undefined, set: () => {} },
        parseData: async ({ data }) => data,
        generateDigest: () => "digest",
      });

      assert.deepEqual([...entries.keys()], ["hello"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stays out of the manifest — it describes this project, not Mica's", () => {
    const manifest = createManifest(site, "test") as unknown as Record<string, unknown>;

    // Mica finds the content root by this file, or MICA_CONTENT_PATH names it. A developer's
    // local path arriving in the manifest could only mislead.
    assert.equal(manifest["root"], undefined);
    assert.deepEqual(Object.keys(manifest).sort(), [
      "collections",
      "generatedBy",
      "protocolVersion",
      "singletons",
    ]);
  });
});

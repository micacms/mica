import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collection,
  createManifest,
  defineSite,
  MANIFEST_PATH,
  memorySource,
  readManifest,
  id,
  text,
  type ContentSource,
} from "@micacms/core/internal";

import { loadSchema, schemaFingerprint, SchemaError } from "../src/schema.js";

/** The smallest manifest that satisfies `defineSite`: every collection needs an ID. */

const checkSchema = (raw: unknown) => readManifest(raw).site;
const validSite = () => ({
  protocolVersion: 1,
  generatedBy: "test",
  collections: {
    pages: {
      type: "collection",
      name: "pages",
      label: "Pages",
      fields: {
        title: { kind: "text", label: "Title", required: true },
        id: { kind: "id", from: "title" },
      },
    },
  },
  singletons: {},
});

describe("loadSchema", () => {
  /** A source with just the manifest in it, the way a content repository has. */
  const repository = (files: Record<string, string>) => memorySource(files, "acme/website/content");

  it("reads the model the Astro project published", async () => {
    const site = await loadSchema(
      repository({ [MANIFEST_PATH]: JSON.stringify(createManifest(checkSchema(validSite()), "test")) }),
    );

    assert.deepEqual(Object.keys(site.collections), ["pages"]);
  });

  it("accepts a bare model, without the protocol envelope", async () => {
    const site = await loadSchema(repository({ [MANIFEST_PATH]: JSON.stringify(validSite()) }));
    assert.deepEqual(Object.keys(site.collections), ["pages"]);
  });

  it("says how to publish a model rather than that a file is missing", async () => {
    await assert.rejects(loadSchema(repository({})), (error: Error) => {
      assert.ok(error instanceof SchemaError);
      assert.match(error.message, /No content model at/);
      assert.match(error.message, /astro build/);
      assert.match(error.message, /commit/);
      return true;
    });
  });

  it("blames the repository, not the model, when the read itself fails", async () => {
    const unreachable: ContentSource = {
      origin: "github:acme/website",
      read: () => Promise.reject(new Error("502 Bad Gateway")),
      list: () => Promise.resolve([]),
    };

    await assert.rejects(loadSchema(unreachable), (error: Error) => {
      assert.ok(error instanceof SchemaError);
      assert.match(error.message, /502 Bad Gateway/);
      // The fix is "make the repository reachable", not "publish a model".
      assert.doesNotMatch(error.message, /No content model at/);
      return true;
    });
  });

  it("reports malformed JSON as such", async () => {
    await assert.rejects(
      loadSchema(repository({ [MANIFEST_PATH]: '{"collections":' })),
      /is not valid JSON/,
    );
  });

  it("refuses a manifest from a newer protocol than this build understands", async () => {
    const manifest = { ...createManifest(checkSchema(validSite()), "test"), protocolVersion: 99 };

    await assert.rejects(
      loadSchema(repository({ [MANIFEST_PATH]: JSON.stringify(manifest) })),
      /protocol version 99/,
    );
  });

  it("names the repository and the file in every message", async () => {
    await assert.rejects(loadSchema(repository({})), /acme\/website\/content\/\.mica\/schema\.json/);
  });
});

describe("schemaFingerprint", () => {
  it("is stable across a serialisation round-trip", async () => {
    const site = checkSchema(validSite());
    const roundTripped = checkSchema(JSON.parse(JSON.stringify(createManifest(site, "test"))));

    assert.equal(await schemaFingerprint(site), await schemaFingerprint(roundTripped));
  });

  it("changes when the model changes", async () => {
    const before = checkSchema(validSite());

    const raw = validSite();
    (raw.collections.pages.fields as Record<string, unknown>)["intro"] = { kind: "textarea" };
    const after = checkSchema(raw);

    assert.notEqual(await schemaFingerprint(before), await schemaFingerprint(after));
  });
});

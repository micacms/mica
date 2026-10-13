import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collection,
  createManifest,
  defineSite,
  MANIFEST_PATH,
  memorySource,
  slug,
  text,
  type ContentSource,
} from "@micacms/core";

import { checkSchema, loadSchema, readOnlyParts, schemaFingerprint, SchemaError } from "../src/schema.js";

/** The smallest model that satisfies `defineSite`: every collection needs a slug. */
const validSite = () => ({
  collections: {
    pages: {
      type: "collection",
      name: "pages",
      label: "Pages",
      fields: {
        title: { kind: "text", label: "Title", required: true },
        slug: { kind: "slug", from: "title" },
      },
    },
  },
  singletons: {},
});

describe("checkSchema", () => {
  it("accepts a model that came back from JSON", () => {
    const original = defineSite({
      collections: {
        pages: collection({
          label: "Pages",
          fields: { title: text({ required: true }), slug: slug({ from: "title" }) },
        }),
      },
    });

    const site = checkSchema(JSON.parse(JSON.stringify(original)));
    assert.deepEqual(site, original);
  });

  it("injects collection names from the keys, as defineSite does", () => {
    const raw = validSite();
    // A hand-edited or hand-written schema may carry no name at all.
    delete (raw.collections.pages as { name?: string }).name;

    const site = checkSchema(raw);
    assert.equal(site.collections["pages"]?.name, "pages");
  });

  for (const [label, value] of [
    ["null", null],
    ["a string", "collections"],
    ["a number", 7],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.throws(() => checkSchema(value), SchemaError);
    });
  }

  it("rejects a model with no collections", () => {
    assert.throws(() => checkSchema({ globals: {} }), /has no `collections`/);
  });

  it("rejects a collection with no fields object", () => {
    assert.throws(
      () => checkSchema({ collections: { pages: { label: "Pages" } } }),
      /has no `fields` object/,
    );
  });

  // A newer @micacms/astro must not stop the editors: only the part with the new kind is locked.
  it("accepts an unknown kind, and makes only its collection read-only", () => {
    const raw = validSite();
    (raw.collections as Record<string, unknown>)["news"] = {
      type: "collection",
      label: "News",
      fields: { title: { kind: "text" }, slug: { kind: "slug" } },
    };
    (raw.collections.pages.fields as Record<string, unknown>)["mystery"] = { kind: "quantum" };

    const site = checkSchema(raw);
    const readOnly = readOnlyParts(site);

    assert.deepEqual([...readOnly.keys()], ["collections.pages"]);
    assert.match(readOnly.get("collections.pages")!, /"mystery" \(quantum\)/);
    assert.match(readOnly.get("collections.pages")!, /Upgrade Mica/);
  });

  it("finds an unknown kind nested inside a repeater, and in a singleton", () => {
    const raw = validSite();
    (raw.collections.pages.fields as Record<string, unknown>)["rows"] = {
      kind: "repeater",
      fields: { bad: { kind: "not-a-kind" } },
    };
    (raw.singletons as Record<string, unknown>)["settings"] = {
      type: "singleton",
      label: "Settings",
      fields: { logo: { kind: "vector" } },
    };

    const readOnly = readOnlyParts(checkSchema(raw));
    assert.match(readOnly.get("collections.pages")!, /"rows\.bad" \(not-a-kind\)/);
    assert.match(readOnly.get("singletons.settings")!, /"logo" \(vector\)/);
  });

  it("makes a collection read-only when its recorded layout is not the one this build derives", () => {
    const raw = validSite();
    (raw.collections.pages as Record<string, unknown>)["layout"] = "directory";
    assert.match(readOnlyParts(checkSchema(raw)).get("collections.pages")!, /stored as directory/);
  });

  it("still refuses a manifest with a newer protocol version", () => {
    const manifest = { ...validSite(), protocolVersion: 99, generatedBy: "@micacms/astro" };
    assert.throws(() => checkSchema(manifest), /protocol version 99/);
  });

  it("still applies the cross-reference checks defineSite performs", () => {
    const raw = validSite();
    (raw.collections.pages.fields as Record<string, unknown>)["author"] = {
      kind: "relation",
      collection: "people",
    };

    // "people" does not exist; defineSite catches it and checkSchema reports it.
    assert.throws(() => checkSchema(raw), /unknown collection "people"/);
  });

  /**
   * Every model committed before the sort field was checked can contain one of
   * these — the old fixed list offered `publishedAt`, and no collection ever
   * had a field by that name. Refusing to serve a site over the order of a
   * list would be out of proportion to the mistake.
   */
  it("drops a default sort by an absent field rather than refusing the model", () => {
    const raw = validSite();
    (raw.collections.pages as Record<string, unknown>)["defaultSort"] = {
      field: "publishedAt",
      direction: "desc",
    };

    const site = checkSchema(raw);

    assert.equal(site.collections["pages"]?.defaultSort, undefined);
  });

  it("keeps the toolbar features it knows, from a newer model, rather than refusing it", () => {
    const raw = validSite();
    const fields = raw.collections.pages.fields as Record<string, unknown>;
    fields["body"] = { kind: "richText", toolbar: ["bold", "underline", "table"] };
    fields["intro"] = { kind: "richText", toolbar: "maximal" };
    fields["more"] = { kind: "object", fields: { text: { kind: "richText", toolbar: ["video"] } } };

    const site = checkSchema(raw);
    const loaded = site.collections["pages"]!.fields as Record<string, { toolbar?: unknown; fields?: Record<string, { toolbar?: unknown }> }>;

    assert.deepEqual(loaded["body"]?.toolbar, ["bold", "table"]);
    assert.equal(loaded["intro"]?.toolbar, undefined);
    assert.deepEqual(loaded["more"]?.fields?.["text"]?.toolbar, []);
  });

  it("keeps a default sort that names a real field", () => {
    const raw = validSite();
    (raw.collections.pages as Record<string, unknown>)["defaultSort"] = {
      field: "title",
      direction: "asc",
    };

    assert.deepEqual(checkSchema(raw).collections["pages"]?.defaultSort, {
      field: "title",
      direction: "asc",
    });
  });
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
    const roundTripped = checkSchema(JSON.parse(JSON.stringify(site)));

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

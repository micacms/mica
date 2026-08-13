import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, slug, text } from "@micacms/model";

import { checkSchema, loadSchema, schemaFingerprint, SchemaError } from "../src/server/schema.js";

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

  it("names the field when a kind is unknown to this build", () => {
    const raw = validSite();
    (raw.collections.pages.fields as Record<string, unknown>)["mystery"] = { kind: "quantum" };

    assert.throws(() => checkSchema(raw), (error: Error) => {
      assert.ok(error instanceof SchemaError);
      assert.match(error.message, /collections\.pages\.mystery/);
      assert.match(error.message, /unknown kind "quantum"/);
      // The likeliest cause is a version skew, and saying so saves a hunt.
      assert.match(error.message, /newer @micacms\/model/);
      return true;
    });
  });

  it("finds an unknown kind nested inside a repeater", () => {
    const raw = validSite();
    (raw.collections.pages.fields as Record<string, unknown>)["rows"] = {
      kind: "repeater",
      fields: { bad: { kind: "not-a-kind" } },
    };

    assert.throws(() => checkSchema(raw), /collections\.pages\.rows\.bad/);
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
});

describe("loadSchema", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mica-schema-"));
  });
  after(() => {
    /* mkdtemp lives under the OS temp dir; the runner is not responsible for it. */
  });

  it("reads a compiled model from JSON", async () => {
    const file = path.join(dir, "schema.json");
    await writeFile(file, JSON.stringify(validSite()));

    const site = await loadSchema(file);
    assert.deepEqual(Object.keys(site.collections), ["pages"]);
  });

  it("reads a model from an ES module's default export", async () => {
    const file = path.join(dir, "schema.mjs");
    await writeFile(file, `export default ${JSON.stringify(validSite())};`);

    const site = await loadSchema(file);
    assert.deepEqual(Object.keys(site.collections), ["pages"]);
  });

  it("says the model is missing rather than failing obscurely", async () => {
    await assert.rejects(loadSchema(path.join(dir, "absent.json")), (error: Error) => {
      assert.ok(error instanceof SchemaError);
      assert.match(error.message, /No content model at/);
      assert.match(error.message, /build:schema/);
      return true;
    });
  });

  it("distinguishes a broken import inside the model from a missing model", async () => {
    const file = path.join(dir, "broken.mjs");
    await writeFile(file, `import "@micacms/definitely-not-installed";\nexport default {};`);

    await assert.rejects(loadSchema(file), (error: Error) => {
      assert.ok(error instanceof SchemaError);
      // The file is present; saying "no content model here" would misdirect.
      assert.doesNotMatch(error.message, /No content model at/);
      assert.match(error.message, /one of its own imports is missing/);
      return true;
    });
  });

  it("reports malformed JSON as such", async () => {
    const file = path.join(dir, "truncated.json");
    await writeFile(file, '{"collections":');

    await assert.rejects(loadSchema(file), /is not valid JSON/);
  });

  it("refuses a file it has no way to interpret", async () => {
    const file = path.join(dir, "schema.yaml");
    await writeFile(file, "collections: {}");

    await assert.rejects(loadSchema(file), /unsupported extension/);
  });

  it("requires a default or `site` export", async () => {
    const file = path.join(dir, "nameless.mjs");
    await writeFile(file, `export const somethingElse = ${JSON.stringify(validSite())};`);

    await assert.rejects(loadSchema(file), /exports neither a default nor a `site` binding/);
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

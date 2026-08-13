/**
 * The authoring format.
 *
 * The property that matters most is the round trip: anything an editor saves
 * has to come back out of the repository unchanged. Everything else here —
 * layout choice, path derivation, byte-level determinism — exists to make a
 * content directory something a person can read and Git can diff.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boolean,
  collection,
  collectionEntryPath,
  color,
  createManifest,
  defineSite,
  documentName,
  documentPath,
  entryFiles,
  entryLayout,
  FormatError,
  isProtocolManifest,
  media,
  number,
  object,
  parseEntry,
  PROTOCOL_VERSION,
  repeater,
  richText,
  serializeEntry,
  singleton,
  singletonPath,
  slug,
  text,
  url,
  type FieldMap,
} from "../dist/index.js";

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

describe("layout", () => {
  const flat: FieldMap = { title: text(), slug: slug(), year: number() };
  const withText: FieldMap = { title: text(), body: richText() };
  const withMedia: FieldMap = { title: text(), logo: media() };

  it("keeps an entry in one file when nothing needs a sidecar", () => {
    assert.equal(entryLayout(flat), "file");
  });

  it("uses a directory when the model has rich text or media", () => {
    assert.equal(entryLayout(withText), "directory");
    assert.equal(entryLayout(withMedia), "directory");
  });

  it("looks through objects and repeaters for sidecar fields", () => {
    assert.equal(entryLayout({ seo: object({ fields: { title: text() } }) }), "file");
    assert.equal(entryLayout({ seo: object({ fields: { intro: richText() } }) }), "directory");
    assert.equal(entryLayout({ rows: repeater({ fields: { image: media() } }) }), "directory");
  });

  it("derives paths from the layout", () => {
    assert.equal(collectionEntryPath(flat, "team", "anna-vogt"), "team/anna-vogt.json");
    assert.equal(collectionEntryPath(withText, "projects", "buchholzstrasse"), "projects/buchholzstrasse");
    assert.equal(singletonPath(flat, "theme"), "theme.json");
    assert.equal(singletonPath(withText, "site"), "site");
  });

  it("round-trips a document name through its field path", () => {
    assert.equal(documentName(["body"]), "body.mdoc");
    assert.equal(documentName(["sections", 0, "body"]), "sections.0.body.mdoc");
    assert.deepEqual(documentPath("body.mdoc"), ["body"]);
    assert.deepEqual(documentPath("sections.0.body.mdoc"), ["sections", 0, "body"]);
  });

  it("refuses a file name that is not a document", () => {
    assert.throws(() => documentPath("index.json"), FormatError);
  });

  it("places every file of a directory entry beside its index", () => {
    const files = entryFiles(withText, "projects/buchholzstrasse", {
      data: "{}\n",
      documents: { "body.mdoc": "Hello\n" },
    });

    assert.deepEqual(Object.keys(files).sort(), [
      "projects/buchholzstrasse/body.mdoc",
      "projects/buchholzstrasse/index.json",
    ]);
  });

  it("rejects a sidecar on an entry that has file layout", () => {
    assert.throws(
      () => entryFiles(flat, "team/anna-vogt.json", { data: "{}\n", documents: { "x.mdoc": "y" } }),
      FormatError,
    );
  });
});

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

const fields: FieldMap = {
  title: text({ required: true }),
  slug: slug({ from: "title" }),
  year: number(),
  featured: boolean(),
  accent: color(),
  body: richText(),
  seo: object({ fields: { metaTitle: text(), intro: richText() } }),
  sections: repeater({ fields: { heading: text(), body: richText() } }),
  cover: media(),
};

const payload = {
  title: "Buchholzstrasse",
  slug: "buchholzstrasse",
  year: 2024,
  featured: true,
  accent: "#1a2b3c",
  body: "# Overview\n\nA housing project.",
  seo: { metaTitle: "Buchholzstrasse", intro: "Short intro." },
  sections: [
    { heading: "Brief", body: "The brief was..." },
    { heading: "Result", body: null },
  ],
  cover: "media/exterior.jpg",
};

describe("serializeEntry", () => {
  it("writes each rich-text field to its own document", () => {
    const { documents } = serializeEntry(fields, payload);

    assert.deepEqual(Object.keys(documents).sort(), [
      "body.mdoc",
      "sections.0.body.mdoc",
      "seo.intro.mdoc",
    ]);
    assert.equal(documents["body.mdoc"], "# Overview\n\nA housing project.\n");
    assert.equal(documents["sections.0.body.mdoc"], "The brief was...\n");
  });

  it("keeps rich text out of the JSON entirely", () => {
    const { data } = serializeEntry(fields, payload);
    const parsed = JSON.parse(data) as Record<string, unknown>;

    assert.equal("body" in parsed, false);
    assert.equal("intro" in (parsed["seo"] as Record<string, unknown>), false);
    assert.equal(parsed["title"], "Buchholzstrasse");
  });

  it("writes no document for an empty rich-text field", () => {
    const { documents } = serializeEntry(fields, { ...payload, body: "   " });
    assert.equal("body.mdoc" in documents, false);
  });

  it("orders keys by the model, not by the payload", () => {
    const shuffled = { cover: "media/a.jpg", year: 2024, title: "A", slug: "a" };
    const { data } = serializeEntry(fields, shuffled);

    assert.deepEqual(Object.keys(JSON.parse(data) as object), [
      "title",
      "slug",
      "year",
      "featured",
      "accent",
      "seo",
      "sections",
      "cover",
    ]);
  });

  it("is byte-identical for equal content, whatever the key order", () => {
    // The same payload, rebuilt with its keys reversed — which is what an
    // editor sending a form back, or a hand edit, plausibly produces.
    const reversed = Object.fromEntries(Object.entries(payload).reverse());

    const a = serializeEntry(fields, payload);
    const b = serializeEntry(fields, reversed);

    assert.equal(a.data, b.data);
    assert.deepEqual(a.documents, b.documents);
  });

  it("drops keys the model no longer declares", () => {
    const { data } = serializeEntry(fields, { ...payload, retired: "gone" });
    assert.equal("retired" in (JSON.parse(data) as object), false);
  });

  it("ends every file with a newline", () => {
    const { data, documents } = serializeEntry(fields, payload);

    assert.equal(data.endsWith("\n"), true);
    for (const contents of Object.values(documents)) {
      assert.equal(contents.endsWith("\n"), true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Round trip
 * ------------------------------------------------------------------ */

describe("parseEntry", () => {
  it("returns what was serialized", () => {
    const parsed = parseEntry(fields, serializeEntry(fields, payload));
    assert.deepEqual(parsed, payload);
  });

  it("survives a second trip unchanged", () => {
    const once = serializeEntry(fields, payload);
    const twice = serializeEntry(fields, parseEntry(fields, once));

    assert.equal(twice.data, once.data);
    assert.deepEqual(twice.documents, once.documents);
  });

  it("reads an entry written without a field the model has since gained", () => {
    const parsed = parseEntry(fields, { data: '{ "title": "A" }' });

    assert.equal(parsed["title"], "A");
    assert.equal(parsed["year"], null);
    assert.equal(parsed["featured"], false);
    assert.deepEqual(parsed["sections"], []);
  });

  it("treats a missing document as an empty field", () => {
    const parsed = parseEntry(fields, { data: '{ "title": "A" }', documents: {} });
    assert.equal(parsed["body"], null);
  });

  it("ignores a document whose path no longer names a rich-text field", () => {
    const parsed = parseEntry(fields, {
      data: '{ "title": "A" }',
      documents: { "retired.mdoc": "x", "sections.9.body.mdoc": "y", "title.mdoc": "z" },
    });

    assert.equal(parsed["title"], "A");
    assert.equal("retired" in parsed, false);
  });

  it("accepts a hand-edited document with no trailing newline", () => {
    const parsed = parseEntry(fields, { data: '{ "title": "A" }', documents: { "body.mdoc": "Text" } });
    assert.equal(parsed["body"], "Text");
  });

  it("reports malformed content rather than throwing a bare SyntaxError", () => {
    assert.throws(() => parseEntry(fields, { data: "{ not json" }), FormatError);
    assert.throws(() => parseEntry(fields, { data: "[]" }), FormatError);
  });
});

/* ------------------------------------------------------------------ *
 * Protocol
 * ------------------------------------------------------------------ */

describe("protocol manifest", () => {
  const site = defineSite({
    collections: {
      projects: collection({ label: "Projects", fields: { title: text(), slug: slug() } }),
    },
    singletons: {
      site: singleton({ label: "Site", fields: { homepage: url() } }),
    },
  });

  it("describes both content primitives", () => {
    const manifest = createManifest(site, "@micacms/astro@2.0.0");

    assert.equal(manifest.protocolVersion, PROTOCOL_VERSION);
    assert.equal(manifest.generatedBy, "@micacms/astro@2.0.0");
    assert.deepEqual(Object.keys(manifest.collections), ["projects"]);
    assert.deepEqual(Object.keys(manifest.singletons), ["site"]);
  });

  it("survives the trip through JSON that the protocol implies", () => {
    const manifest = createManifest(site, "test");
    const decoded: unknown = JSON.parse(JSON.stringify(manifest));

    assert.equal(isProtocolManifest(decoded), true);
    assert.deepEqual(decoded, manifest);
  });

  it("rejects an envelope that is not a manifest", () => {
    assert.equal(isProtocolManifest(null), false);
    assert.equal(isProtocolManifest({ collections: {}, singletons: {} }), false);
    assert.equal(
      isProtocolManifest({ protocolVersion: 1, generatedBy: "x", collections: [], singletons: {} }),
      false,
    );
  });
});

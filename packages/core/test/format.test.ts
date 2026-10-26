/**
 * The authoring format.
 *
 * The property that matters most is the round trip: anything an editor saves
 * has to come back out of the repository unchanged. Everything else here —
 * path derivation, byte-level determinism — exists to make a
 * content directory something a person can read and Git can diff.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boolean,
  collection,
  color,
  createManifest,
  defineSite,
  documentName,
  declaresDocument,
  documentPath,
  entryDataPath,
  entryFiles,
  entryFolder,
  fieldsSchema,
  FormatError,
  isProtocolManifest,
  isRowKey,
  media,
  number,
  object,
  parseEntry,
  PROTOCOL_VERSION,
  repeater,
  richText,
  serializeEntry,
  singleton,
  id,
  text,
  url,
  withEmptyValues,
  type FieldMap,
} from "../src/internal.js";

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

describe("layout", () => {
  it("gives every entry and every singleton a folder with index.json", () => {
    assert.equal(entryFolder("team", "anna-vogt"), "team/anna-vogt");
    assert.equal(entryFolder("site"), "site");
    assert.equal(entryDataPath("team", "anna-vogt"), "team/anna-vogt/index.json");
    assert.equal(entryDataPath("site"), "site/index.json");
  });

  it("round-trips a document name through its field path", () => {
    assert.equal(documentName(["body"]), "body.mdoc");
    assert.equal(documentName(["sections", "kbrief", "body"]), "sections.kbrief.body.mdoc");
    assert.deepEqual(documentPath("body.mdoc"), ["body"]);
    assert.deepEqual(documentPath("sections.kbrief.body.mdoc"), ["sections", "kbrief", "body"]);
  });

  it("refuses a file name that is not a document", () => {
    assert.throws(() => documentPath("index.json"), FormatError);
  });

  it("places every file of a directory entry beside its index", () => {
    const files = entryFiles("projects/buchholzstrasse", {
      data: "{}\n",
      documents: { "body.mdoc": "Hello\n" },
    });

    assert.deepEqual(Object.keys(files).sort(), [
      "projects/buchholzstrasse/body.mdoc",
      "projects/buchholzstrasse/index.json",
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

const fields: FieldMap = {
  title: text({ required: true }),
  id: id({ from: "title" }),
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
  id: "buchholzstrasse",
  year: 2024,
  featured: true,
  accent: "#1a2b3c",
  body: "# Overview\n\nA housing project.",
  seo: { metaTitle: "Buchholzstrasse", intro: "Short intro." },
  sections: [
    { _key: "kbrief", heading: "Brief", body: "The brief was..." },
    { _key: "kresult", heading: "Result", body: null },
  ],
  cover: "media/exterior.jpg",
};

describe("serializeEntry", () => {
  it("writes each rich-text field to its own document", () => {
    const { documents } = serializeEntry(fields, payload);

    assert.deepEqual(Object.keys(documents).sort(), [
      "body.mdoc",
      "sections.kbrief.body.mdoc",
      "seo.intro.mdoc",
    ]);
    assert.equal(documents["body.mdoc"], "# Overview\n\nA housing project.\n");
    assert.equal(documents["sections.kbrief.body.mdoc"], "The brief was...\n");
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
    const shuffled = { cover: "media/a.jpg", year: 2024, title: "A", id: "a" };
    const { data } = serializeEntry(fields, shuffled);

    assert.deepEqual(Object.keys(JSON.parse(data) as object), [
      "title",
      "id",
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
      documents: { "retired.mdoc": "x", "sections.kgone.body.mdoc": "y", "title.mdoc": "z" },
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
 * Repeater row keys (#220)
 * ------------------------------------------------------------------ */

describe("repeater row keys", () => {
  const rows = (data: string) => (JSON.parse(data) as { sections: Array<Record<string, unknown>> }).sections;

  it("gives a key to each row with rich text, and none to a row without", () => {
    const linkFields: FieldMap = { ...fields, links: repeater({ fields: { label: text() } }) };
    const { data } = serializeEntry(linkFields, {
      ...payload,
      sections: [{ heading: "A", body: "x" }, { heading: "B" }],
      links: [{ label: "Home" }],
    });
    const parsed = JSON.parse(data) as { sections: Array<Record<string, unknown>>; links: Array<Record<string, unknown>> };

    assert.equal(parsed.sections.every((row) => isRowKey(row["_key"])), true);
    assert.notEqual(parsed.sections[0]!["_key"], parsed.sections[1]!["_key"]);
    assert.deepEqual(Object.keys(parsed.sections[0]!), ["_key", "heading"]);
    assert.deepEqual(parsed.links, [{ label: "Home" }]);
  });

  it("changes only the JSON when rows are reordered", () => {
    const before = serializeEntry(fields, payload);
    const after = serializeEntry(fields, { ...payload, sections: [...payload.sections].reverse() });

    assert.deepEqual(after.documents, before.documents);
    assert.deepEqual(rows(after.data).map((row) => row["_key"]), ["kresult", "kbrief"]);
  });

  it("replaces a key that is not valid or that an earlier row has", () => {
    const { data, documents } = serializeEntry(fields, {
      ...payload,
      sections: [
        { _key: "kbrief", body: "one" },
        { _key: "kbrief", body: "two" },
        { _key: "123", body: "three" },
      ],
    });
    const keys = rows(data).map((row) => row["_key"] as string);

    assert.equal(keys[0], "kbrief");
    assert.equal(new Set(keys).size, 3);
    assert.equal(keys.every(isRowKey), true);
    assert.equal(documents[`sections.${keys[1]}.body.mdoc`], "two\n");
  });

  it("places nothing from a document whose row does not exist", () => {
    const parsed = parseEntry(fields, { data: '{ "sections": [{ "heading": "A" }] }', documents: { "sections.0.body.mdoc": "x" } });
    assert.equal((parsed["sections"] as Array<Record<string, unknown>>)[0]!["body"], null);
  });

  it("keys nested repeaters, and the file name carries both keys", () => {
    const nested: FieldMap = { groups: repeater({ fields: { items: repeater({ fields: { body: richText() } }) } }) };
    const { data, documents } = serializeEntry(nested, { groups: [{ _key: "kgroup", items: [{ _key: "kitem", body: "x" }] }] });

    assert.deepEqual(Object.keys(documents), ["groups.kgroup.items.kitem.body.mdoc"]);
    assert.deepEqual(parseEntry(nested, { data, documents }), { groups: [{ _key: "kgroup", items: [{ _key: "kitem", body: "x" }] }] });
  });

  it("keeps the key through a read and validation, and leaves it out for templates", () => {
    const row = { _key: "kbrief", heading: "Brief" };
    const filled = withEmptyValues(fields, { sections: [row] }) as { sections: Array<Record<string, unknown>> };
    assert.equal(filled.sections[0]!["_key"], "kbrief");

    const saved = fieldsSchema(fields, { enforceRequired: false }).parse({ sections: [row] }) as { sections: Array<Record<string, unknown>> };
    assert.equal(saved.sections[0]!["_key"], "kbrief");

    const template = fieldsSchema(fields, { enforceRequired: false, rowKeys: false }).parse({ sections: [row] }) as {
      sections: Array<Record<string, unknown>>;
    };
    assert.equal("_key" in template.sections[0]!, false);
  });
});

/* ------------------------------------------------------------------ *
 * Protocol
 * ------------------------------------------------------------------ */

describe("what the model does not declare (#217)", () => {
  const fields: FieldMap = {
    title: text(),
    seo: object({ fields: { metaTitle: text() } }),
    sections: repeater({ fields: { heading: text(), body: richText() } }),
    links: repeater({ fields: { label: text() } }),
  };

  it("stays in the file after the declared keys: at the top, in objects and in keyed rows", () => {
    const stored = {
      title: "Old",
      newer: "from a newer model",
      seo: { metaTitle: "Old", ogImage: "/media/a.jpg" },
      sections: [{ _key: "kone", heading: "One", layout: "wide" }],
      links: [{ label: "A", rel: "nofollow" }],
    };
    const data = { title: "New", seo: { metaTitle: "New" }, sections: [{ _key: "kone", heading: "One" }], links: [{ label: "A" }] };
    const written = JSON.parse(serializeEntry(fields, data, stored).data);

    assert.deepEqual(Object.keys(written), ["title", "seo", "sections", "links", "newer"]);
    assert.deepEqual(written.seo, { metaTitle: "New", ogImage: "/media/a.jpg" });
    assert.deepEqual(written.sections, [{ _key: "kone", heading: "One", layout: "wide" }]);
    // A row without a key has no identity across a reorder.
    assert.deepEqual(written.links, [{ label: "A" }]);
  });

  it("names the rich-text files that the model declares, and no others", () => {
    assert.equal(declaresDocument(fields, ["sections", "kone", "body"]), true);
    assert.equal(declaresDocument(fields, ["sections", "kone", "heading"]), false);
    assert.equal(declaresDocument(fields, ["summary"]), false);
  });
});

describe("defaults (#221)", () => {
  it("do not fill a cleared rich-text field on read", () => {
    const fields: FieldMap = { body: richText({ default: "Write here." }), live: boolean({ default: true }) };
    assert.deepEqual(parseEntry(fields, { data: "{}" }), { body: null, live: false });
  });
});

describe("protocol manifest", () => {
  const site = defineSite({
    collections: {
      projects: collection({ label: "Projects", fields: { title: text(), id: id() } }),
    },
    singletons: {
      site: singleton({ label: "Site", fields: { homepage: url() } }),
    },
  });

  it("describes both content primitives", () => {
    const manifest = createManifest(site, "@micacms/astro");

    assert.equal(manifest.protocolVersion, PROTOCOL_VERSION);
    assert.equal(manifest.generatedBy, "@micacms/astro");
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

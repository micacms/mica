/** `readManifest` checks a manifest as untrusted input, for every reader. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collection, coordinates, createManifest, defineSite, ManifestError, readManifest, id, text } from "../src/index.js";

/** The smallest manifest that satisfies `defineSite`: every collection needs an ID. */
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
    } as Record<string, unknown> & { fields: Record<string, unknown> },
  },
  singletons: {} as Record<string, unknown>,
});

const checkSchema = (raw: unknown) => readManifest(raw).site;
const readOnlyParts = (raw: unknown) => readManifest(raw).readOnly;

describe("readManifest", () => {
  it("accepts a model that came back from JSON", () => {
    const original = defineSite({
      collections: {
        pages: collection({
          label: "Pages",
          fields: { title: text({ required: true }), id: id({ from: "title" }) },
        }),
      },
    });

    const site = checkSchema(JSON.parse(JSON.stringify(createManifest(original, "test"))));
    assert.deepEqual(site, original);
  });

  it("keeps the site's label, and leaves out one that it cannot use, with a warning", () => {
    const named = defineSite({
      label: "Harbor Lane Consulting",
      collections: { pages: collection({ label: "Pages", fields: { title: text(), id: id({ from: "title" }) } }) },
    });
    const manifest = JSON.parse(JSON.stringify(createManifest(named, "test")));
    assert.equal(manifest.label, "Harbor Lane Consulting");
    assert.equal(checkSchema(manifest).label, "Harbor Lane Consulting");

    for (const label of ["", "   ", 7, "x".repeat(61)]) {
      const read = readManifest({ ...validSite(), label });
      assert.equal(read.site.label, undefined);
      assert.match(read.warnings.join("\n"), /The site's label/);
    }
    assert.equal("label" in createManifest(defineSite({ collections: {} }), "test"), false);
  });

  it("refuses a site label in the model that the editor cannot show", () => {
    assert.throws(() => defineSite({ label: " ", collections: {} }), /The site's label must be a text that is not empty/);
    assert.throws(() => defineSite({ label: "x".repeat(61), collections: {} }), /60 characters at most/);
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
      assert.throws(() => checkSchema(value), ManifestError);
    });
  }

  it("rejects a bare model without the protocol envelope", () => {
    assert.throws(() => checkSchema({ collections: {}, singletons: {} }), /not a Mica manifest/);
  });

  it("rejects a collection with no fields object", () => {
    assert.throws(
      () => checkSchema({ ...validSite(), collections: { pages: { label: "Pages" } } }),
      /has no `fields` object/,
    );
  });

  // A newer @micacms/astro must not stop the editors: only the part with the new kind is locked.
  it("accepts an unknown kind, and makes only its collection read-only", () => {
    const raw = validSite();
    (raw.collections as Record<string, unknown>)["news"] = {
      type: "collection",
      label: "News",
      fields: { title: { kind: "text" }, id: { kind: "id" } },
    };
    (raw.collections.pages.fields as Record<string, unknown>)["mystery"] = { kind: "quantum" };

    const readOnly = readOnlyParts(raw);

    assert.deepEqual([...readOnly.keys()], ["collections.pages"]);
    assert.match(readOnly.get("collections.pages")!, /"mystery" \(quantum\)/);
    assert.match(readOnly.get("collections.pages")!, /does not know: a newer or an older version of Mica wrote the model/);
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

    const readOnly = readOnlyParts(raw);
    assert.match(readOnly.get("collections.pages")!, /"rows\.bad" \(not-a-kind\)/);
    assert.match(readOnly.get("singletons.settings")!, /"logo" \(vector\)/);
  });

  it("still refuses a manifest with a newer protocol version", () => {
    const manifest = { ...validSite(), protocolVersion: 99 };
    assert.throws(() => checkSchema(manifest), /protocol version 99/);
  });

  it("still applies the cross-reference checks defineSite performs", () => {
    const raw = validSite();
    (raw.collections.pages.fields as Record<string, unknown>)["author"] = {
      kind: "relation",
      collection: "people",
    };

    // "people" does not exist; defineSite catches it and readManifest reports it.
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

  it("leaves out a page address that this version cannot read, rather than refusing the model", () => {
    const raw = validSite();
    (raw.collections.pages as Record<string, unknown>)["url"] = "/pages/{year}/{id}";
    const read = readManifest(raw);
    assert.equal(read.site.collections["pages"]?.url, undefined);
    assert.match(read.warnings.join("\n"), /cannot read\. The editor shows no link/);
  });

  it("keeps a page address that names a select field beside {id}", () => {
    const raw = validSite();
    raw.collections.pages.fields["section"] = { kind: "select", options: [{ label: "About", value: "about" }] };
    (raw.collections.pages as Record<string, unknown>)["url"] = "/{section}/{id}";
    const read = readManifest(raw);
    assert.equal(read.site.collections["pages"]?.url, "/{section}/{id}");
    assert.deepEqual(read.warnings, []);
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

describe("options that this build does not know", () => {
  // A newer option can change what is stored, as `media({ alt })` did: writing without it could lose data.
  it("make their collection read-only, like an unknown kind", () => {
    const raw = validSite();
    raw.collections.pages.fields["cover"] = { kind: "media", crop: "square" };
    assert.match(readOnlyParts(raw).get("collections.pages")!, /"cover" \(option crop\)/);
  });

  it("include a file type in `accept`, which keeps the types it knows", () => {
    const raw = validSite();
    raw.collections.pages.fields["track"] = { kind: "media", accept: ["gpx", "fit"] };
    raw.collections.pages.fields["video"] = { kind: "media", accept: "video" };

    const read = readManifest(raw);
    assert.match(read.readOnly.get("collections.pages")!, /"track" \(file type fit\).*"video" \(accept video\)/);
    const fields = read.site.collections["pages"]!.fields as Record<string, { accept?: unknown }>;
    assert.deepEqual(fields["track"]?.accept, ["gpx"]);
    assert.equal(fields["video"]?.accept, undefined);
  });

  it("are none in a manifest that this build writes", () => {
    const site = defineSite({
      collections: {
        pages: collection({
          label: "Pages",
          fields: { title: text({ required: true, maxLength: 80 }), id: id({ from: "title" }), where: coordinates({ map: "liberty" }) },
        }),
      },
    });
    assert.deepEqual(readManifest(JSON.parse(JSON.stringify(createManifest(site, "test")))).readOnly.size, 0);
  });

  it("refuse a map that is not https, from a manifest as from the model", () => {
    const raw = validSite();
    raw.collections.pages.fields["where"] = { kind: "coordinates", map: { style: "http://maps.example.com/style.json" } };
    assert.throws(() => readManifest(raw), (error: unknown) => error instanceof ManifestError && /invalid map/.test(error.message));
  });

  it("warn when only buttons or a list order are left out", () => {
    const raw = validSite();
    raw.collections.pages["defaultSort"] = { field: "publishedAt", direction: "desc" };
    raw.collections.pages.fields["body"] = { kind: "richText", toolbar: ["bold", "video"] };
    assert.equal(readManifest(raw).warnings.length, 2);
  });
});

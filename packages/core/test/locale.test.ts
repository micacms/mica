/** Localized fields (docs/adr/0042-localized-fields.md): the expansion, the model rules, the stored form and the fallback. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collection,
  compareEntries,
  createManifest,
  defaultValues,
  defineSite,
  entryTitle,
  id,
  localize,
  media,
  ModelError,
  object,
  parseEntry,
  readManifest,
  repeater,
  richText,
  serializeEntry,
  singleton,
  text,
  validateFields,
  type InferCollection,
  type Localize,
  type LocalizedValue,
} from "../src/internal.js";

/** Compiles only when `A` and `B` are the same type. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const pages = collection({
  label: "Pages",
  fields: {
    id: id(),
    title: text({ label: "Title", required: true, maxLength: 20, localized: true }),
    body: richText({ localized: true }),
    legal: text({ localized: { fallback: false } }),
    image: media({ accept: "image" }),
    sections: repeater({ fields: { heading: text({ localized: true }) } }),
  },
});

const site = () => defineSite({ locales: ["de", "en", "fr"], defaultLocale: "de", fallback: { fr: "en" }, collections: { pages } });

describe("a localized field", () => {
  it("is an object with one field for each locale, and required and default go to the default locale", () => {
    const title = site().collections.pages.fields.title;
    assert.equal(title.kind, "object");
    const fields = (title as unknown as { fields: Record<string, { kind: string; required?: boolean; label?: string }> }).fields;
    assert.deepEqual(Object.keys(fields), ["de", "en", "fr"]);
    assert.equal(fields["de"]!.required, true);
    assert.equal(fields["en"]!.required, undefined);
    assert.equal(fields["en"]!.kind, "text");
    assert.equal(fields["en"]!.label, "Title (EN)");
    assert.equal((title as { label?: string }).label, "Title");
  });

  it("expands inside a repeater's rows", () => {
    const sections = site().collections.pages.fields.sections as unknown as { fields: { heading: { kind: string } } };
    assert.equal(sections.fields.heading.kind, "object");
  });

  it("is stored as the object pattern, with a Markdoc file for each locale", () => {
    const { fields } = site().collections.pages;
    const stored = serializeEntry(fields, { id: "about", title: { de: "Über uns", en: "About us" }, body: { de: "Text.", en: "Text." } });
    assert.deepEqual(Object.keys(stored.documents).sort(), ["body.de.mdoc", "body.en.mdoc"]);
    assert.deepEqual(JSON.parse(stored.data).title, { de: "Über uns", en: "About us", fr: null });
    const read = parseEntry(fields, { data: stored.data, documents: stored.documents });
    assert.deepEqual(read["body"], { de: "Text.", en: "Text.", fr: null });
  });

  it("needs a value in the default locale only", () => {
    const { fields } = site().collections.pages;
    const missing = validateFields(fields, { id: "about", title: { en: "About us" } });
    assert.equal(missing.ok, false);
    assert.deepEqual(!missing.ok && missing.issues.map((issue) => issue.path), ["title.de"]);
    assert.equal(validateFields(fields, { id: "about", title: { de: "Über uns" } }).ok, true);
    const long = validateFields(fields, { id: "about", title: { de: "Über uns", fr: "Une phrase beaucoup trop longue" } });
    assert.deepEqual(!long.ok && long.issues.map((issue) => issue.path), ["title.fr"]);
  });

  it("gives its default to the default locale", () => {
    const local = defineSite({ locales: ["de", "en"], collections: { pages: collection({ label: "Pages", fields: { id: id(), title: text({ default: "Neu", localized: true }) } }) } });
    assert.deepEqual(defaultValues(local.collections.pages.fields)["title"], { de: "Neu", en: null });
  });

  it("names the title of an entry in the first locale that has one", () => {
    assert.equal(entryTitle(site().collections.pages, { id: "about", title: { de: null, en: "About us" } }), "About us");
  });

  it("comes back from the manifest as it went in", () => {
    const written = createManifest(site(), "@micacms/astro");
    assert.deepEqual(written.locales, ["de", "en", "fr"]);
    const read = readManifest(JSON.parse(JSON.stringify(written)));
    assert.deepEqual(read.site.collections["pages"]!.fields, site().collections.pages.fields);
    assert.equal(read.site.defaultLocale, "de");
    assert.deepEqual(read.site.fallback, { fr: "en" });
    assert.equal(read.readOnly.size, 0);
  });

  it("puts the default locale first, and names each locale's field by the key in words", () => {
    const local = defineSite({ locales: ["de", "en"], defaultLocale: "en", collections: { pages: collection({ label: "Pages", fields: { id: id(), metaTitle: text({ localized: true }) } }) } });
    const fields = (local.collections.pages.fields.metaTitle as unknown as { fields: Record<string, { label: string }> }).fields;
    assert.deepEqual(Object.keys(fields), ["en", "de"]);
    assert.equal(fields["de"]!.label, "Meta title (DE)");
    assert.equal(entryTitle(local.collections.pages, { id: "x", metaTitle: { de: "Hallo", en: "Hello" } }), "Hello");
  });

  it("sorts by the value of the default locale", () => {
    const local = defineSite({
      locales: ["de", "en"],
      collections: { pages: collection({ label: "Pages", defaultSort: { field: "title", direction: "asc" }, fields: { id: id(), title: text({ localized: true }) } }) },
    });
    const entries = [
      { position: 0, data: { title: { de: "Zebra", en: "Apple" } } },
      { position: 1, data: { title: { de: "Affe", en: "Zoo" } } },
    ];
    assert.deepEqual([...entries].sort(compareEntries(local.collections.pages)).map((entry) => entry.position), [1, 0]);
  });

  it("accepts the object pattern with the locales as keys", () => {
    const local = defineSite({
      locales: ["de", "en-us"],
      collections: { pages: collection({ label: "Pages", fields: { id: id(), title: object({ localized: true, fields: { de: text(), "en-us": text() } }) } }) },
    });
    assert.equal(local.defaultLocale, "de");
    assert.ok(local.collections.pages.fields.title);
  });
});

describe("the model rules of localized fields", () => {
  const model = (fields: Record<string, unknown>, locales: string[] | null = ["de", "en"]) => () =>
    defineSite({ ...(locales ? { locales } : {}), collections: { pages: collection({ label: "Pages", fields: { id: id(), ...fields } as never }) } });

  it("need locales on the site", () => {
    assert.throws(model({ title: text({ localized: true }) }, null), (error: Error) => error instanceof ModelError && /no locales/.test(error.message));
  });

  it("refuse a localized ID field of a collection", () => {
    assert.throws(
      () => defineSite({ locales: ["de"], collections: { pages: collection({ label: "Pages", fields: { id: id({ localized: true }) } }) } }),
      /cannot be localized/,
    );
  });

  it("refuse a localized ID that follows another field", () => {
    assert.throws(model({ title: text({ localized: true }), slug: id({ from: "title", localized: true }) }), /cannot follow another field/);
  });

  it("refuse a container or a localized field in the stored form", () => {
    assert.throws(model({ title: object({ localized: true, fields: { de: object({ fields: {} }), en: text() } }) }), /Localize the fields inside/);
    assert.throws(model({ title: object({ localized: true, fields: { de: text({ localized: true }), en: text() } }) }), /Localize the fields inside/);
  });

  it("refuse a localized container", () => {
    assert.throws(model({ seo: object({ localized: true, fields: { title: text() } }) }), /Localize the fields inside/);
    assert.throws(model({ rows: repeater({ localized: true, fields: { title: text() } }) }), /Localize the fields of its rows/);
  });

  it("refuse locales that cannot be keys and file names", () => {
    assert.throws(model({}, []), /must be a list/);
    assert.throws(model({}, ["de", "en.us"]), /letters, digits and hyphens/);
    assert.throws(model({}, ["en-us", "en-US"]), /differ only in case/);
    assert.throws(model({}, ["de", "de"]), /twice/);
    assert.throws(() => defineSite({ locales: ["de"], defaultLocale: "en", collections: {} }), /not one of the locales/);
    assert.throws(() => defineSite({ locales: ["de", "en"], fallback: { en: "fr" }, collections: {} }), /must name two of the locales/);
    assert.throws(() => defineSite({ locales: ["de", "en", "fr"], fallback: { en: "fr", fr: "en" }, collections: {} }), /circle/);
  });
});

describe("localize", () => {
  const data = {
    id: "about",
    title: { de: "Über uns", en: "About us", fr: null },
    body: { de: "Text.", en: null, fr: null },
    legal: { de: "AGB", en: null, fr: null },
    image: "media/a.png",
    sections: [{ heading: { de: "Eins", en: "One", fr: "Un" } }],
  };

  it("gives the value of the locale", () => {
    const fields = site().collections.pages.fields;
    assert.deepEqual(localize(site(), fields, data, "de"), {
      id: "about",
      title: "Über uns",
      body: "Text.",
      legal: "AGB",
      image: "media/a.png",
      sections: [{ heading: "Eins" }],
    });
  });

  it("falls back through the chain, then to the default locale", () => {
    const fields = site().collections.pages.fields;
    const fr = localize(site(), fields, data, "fr");
    assert.equal(fr.title, "About us");
    assert.equal(fr.body, "Text.");
    assert.equal(fr.sections[0]!.heading, "Un");
  });

  it("keeps a missing value empty with fallback: false", () => {
    assert.equal(localize(site(), site().collections.pages.fields, data, "en").legal, null);
  });

  it("refuses a locale that the site does not have", () => {
    assert.throws(() => localize(site(), site().collections.pages.fields, data, "it"), /not a locale/);
  });
});

describe("the types of localized fields", () => {
  it("are a value for each locale, and one value after localize", () => {
    type Page = InferCollection<typeof pages>;
    const title: Equal<Page["title"], LocalizedValue<string>> = true;
    const localized: Equal<Localize<Page>["title"], string | null> = true;
    const shared: Equal<Localize<Page>["image"], string | null> = true;
    const row: Equal<Localize<Page>["sections"][number]["heading"], string | null> = true;
    assert.ok(title && localized && shared && row);
  });

  it("leave a singleton without localized fields as it is", () => {
    const settings = singleton({ label: "Settings", fields: { name: text() } });
    const same: Equal<Localize<InferCollection<typeof pages>>["id"], string> = true;
    assert.ok(same && settings);
  });
});

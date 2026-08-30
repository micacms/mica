import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boolean,
  collection,
  collectMediaIds,
  color,
  coordinates,
  date,
  defaultValues,
  defineSite,
  email,
  compareEntries,
  entryTitle,
  media,
  ModelError,
  number,
  object,
  relation,
  repeater,
  richText,
  select,
  singleton,
  slug,
  slugify,
  text,
  uniqueSlug,
  url,
  validateFields,
  withDefaults,
  type InferFields,
} from "../dist/index.js";

/* Type-level assertions — these fail at `pnpm typecheck`, not at runtime. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const inferenceFields = {
  title: text({ required: true }),
  subtitle: text(),
  count: number({ required: true }),
  featured: boolean(),
  tags: select({ options: [{ label: "A", value: "a" }], multiple: true }),
  cover: media(),
  gallery: media({ multiple: true }),
  author: relation({ collection: "team" }),
  where: coordinates(),
  facts: repeater({ fields: { label: text({ required: true }) } }),
  seo: object({ fields: { metaTitle: text() } }),
};

type Inferred = InferFields<typeof inferenceFields>;

/* eslint-disable @typescript-eslint/no-unused-vars */
type _Required = Expect<Equal<Inferred["title"], string>>;
type _Optional = Expect<Equal<Inferred["subtitle"], string | null>>;
type _RequiredNumber = Expect<Equal<Inferred["count"], number>>;
type _BooleanNeverNull = Expect<Equal<Inferred["featured"], boolean>>;
type _MultiSelect = Expect<Equal<Inferred["tags"], string[]>>;
type _SingleRelation = Expect<Equal<Inferred["author"], string | null>>;
type _Repeater = Expect<Equal<Inferred["facts"], Array<{ label: string }>>>;
type _Nested = Expect<Equal<Inferred["seo"], { metaTitle: string | null } | null>>;
type _Coordinates = Expect<Equal<Inferred["where"], { lat: number; lng: number } | null>>;
/* eslint-enable @typescript-eslint/no-unused-vars */

describe("slugify", () => {
  it("transliterates German umlauts rather than stripping them", () => {
    assert.equal(slugify("Zürich Grünstrasse"), "zuerich-gruenstrasse");
    assert.equal(slugify("Weißenbach"), "weissenbach");
  });

  it("strips accents and collapses separators", () => {
    assert.equal(slugify("Café  de   Flore!"), "cafe-de-flore");
    assert.equal(slugify("--Hello--World--"), "hello-world");
  });

  it("truncates on a word boundary", () => {
    assert.equal(slugify("alpha beta gamma delta", 14), "alpha-beta");
  });

  it("disambiguates against taken slugs", () => {
    assert.equal(uniqueSlug("haus", []), "haus");
    assert.equal(uniqueSlug("haus", ["haus"]), "haus-2");
    assert.equal(uniqueSlug("haus", ["haus", "haus-2"]), "haus-3");
  });
});

describe("validation", () => {
  const fields = {
    title: text({ label: "Title", required: true, maxLength: 10 }),
    subtitle: text(),
    year: number({ integer: true, min: 1900 }),
    live: boolean(),
    kind: select({ options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }),
    when: date(),
    contact: email(),
    site: url(),
    tint: color(),
    where: coordinates(),
    handle: slug(),
    gallery: media({ multiple: true }),
    rows: repeater({ fields: { label: text({ required: true }) } }),
  };

  it("normalises blank strings and missing keys to null", () => {
    const result = validateFields(fields, { title: "Ok", subtitle: "   ", year: undefined });
    assert.ok(result.ok);
    assert.equal(result.data.subtitle, null);
    assert.equal(result.data.year, null);
    assert.equal(result.data.when, null);
  });

  it("gives multi-value fields and booleans a concrete empty state", () => {
    const result = validateFields(fields, { title: "Ok" });
    assert.ok(result.ok);
    assert.deepEqual(result.data.gallery, []);
    assert.deepEqual(result.data.rows, []);
    assert.equal(result.data.live, false);
  });

  it("rejects a blank required field with the field label", () => {
    const result = validateFields(fields, { title: "  " });
    assert.ok(!result.ok);
    assert.deepEqual(result.issues, [{ path: "title", message: "Title is required." }]);
  });

  it("enforces per-kind constraints", () => {
    const result = validateFields(fields, {
      title: "Ok",
      year: 1800,
      kind: "c",
      contact: "nope",
      site: "ftp://example.com",
      tint: "red",
      handle: "Not A Slug",
      where: { lat: 200, lng: 0 },
    });
    assert.ok(!result.ok);
    const paths = result.issues.map((issue) => issue.path).sort();
    assert.deepEqual(paths, ["contact", "handle", "kind", "site", "tint", "where.lat", "year"]);
  });

  it("reports repeater issues with an indexed path", () => {
    const result = validateFields(fields, { title: "Ok", rows: [{ label: "a" }, { label: "" }] });
    assert.ok(!result.ok);
    assert.equal(result.issues[0]?.path, "rows.1.label");
  });

  it("drops keys that are no longer in the model", () => {
    const result = validateFields(fields, { title: "Ok", removedField: "stale" });
    assert.ok(result.ok);
    assert.ok(!("removedField" in result.data));
  });

  it("expands media references in output mode only", () => {
    const ref = {
      id: "m1",
      url: "/media/m1.jpg",
      filename: "m1.jpg",
      mimeType: "image/jpeg",
      width: 10,
      height: 10,
      size: 100,
      alt: null,
    };
    assert.ok(validateFields(fields, { title: "Ok", gallery: ["m1"] }, "storage").ok);
    assert.ok(!validateFields(fields, { title: "Ok", gallery: ["m1"] }, "output").ok);
    assert.ok(validateFields(fields, { title: "Ok", gallery: [ref] }, "output").ok);
  });

  it("accepts rich text and dates with time", () => {
    const withTime = { body: richText(), at: date({ includeTime: true }) };
    const ok = validateFields(withTime, { body: "<p>Hi</p>", at: "2026-08-11T10:00:00Z" });
    assert.ok(ok.ok);
    const bad = validateFields(withTime, { at: "2026-08-11" });
    assert.ok(!bad.ok);
  });
});

describe("defaults", () => {
  const fields = {
    title: text({ default: "Untitled" }),
    live: boolean({ default: true }),
    gallery: media({ multiple: true }),
    rows: repeater({ fields: { label: text() } }),
    seo: object({ fields: { metaTitle: text() } }),
  };

  it("builds a complete skeleton so form binding never sees a missing key", () => {
    assert.deepEqual(defaultValues(fields), {
      title: "Untitled",
      live: true,
      gallery: [],
      rows: [],
      seo: { metaTitle: null },
    });
  });

  it("backfills keys added to the model after an entry was written", () => {
    const stored = { title: "Old" };
    const filled = withDefaults(fields, stored);
    assert.equal(filled.title, "Old");
    assert.deepEqual(filled.seo, { metaTitle: null });
    assert.deepEqual(filled.rows, []);
  });

  it("backfills inside existing repeater rows", () => {
    const filled = withDefaults(
      { rows: repeater({ fields: { label: text(), extra: text() } }) },
      { rows: [{ label: "a" }] },
    );
    assert.deepEqual(filled.rows, [{ label: "a", extra: null }]);
  });
});

describe("defineSite", () => {
  it("injects collection and global names from the map keys", () => {
    const model = defineSite({
      collections: {
        projects: collection({ label: "Projects", fields: { title: text(), slug: slug() } }),
      },
      singletons: { theme: singleton({ label: "Theme", fields: { primary: color() } }) },
    });
    assert.equal(model.collections.projects.name, "projects");
    assert.equal(model.singletons.theme.name, "theme");
  });

  it("rejects a relation pointing at an unknown collection", () => {
    assert.throws(
      () =>
        defineSite({
          collections: {
            news: collection({
              label: "News",
              fields: { slug: slug(), author: relation({ collection: "tema" }) },
            }),
          },
        }),
      (error: unknown) =>
        error instanceof ModelError && /unknown collection "tema"/.test(error.message),
    );
  });

  it("rejects a collection without a slug field", () => {
    assert.throws(
      () =>
        defineSite({
          collections: { news: collection({ label: "News", fields: { title: text() } }) },
        }),
      ModelError,
    );
  });

  it("rejects a slug deriving from a non-existent sibling", () => {
    assert.throws(
      () =>
        defineSite({
          collections: {
            news: collection({ label: "News", fields: { slug: slug({ from: "titel" }) } }),
          },
        }),
      ModelError,
    );
  });

  /**
   * The mistake this catches was made three times in this repository, in two
   * projects, because the old fixed list of sort fields outlived the database
   * columns it named.
   */
  it("rejects a default sort by a field the collection does not have", () => {
    assert.throws(
      () =>
        defineSite({
          collections: {
            news: collection({
              label: "News",
              defaultSort: { field: "publishedAt", direction: "desc" },
              fields: { title: text(), slug: slug(), publishDate: date() },
            }),
          },
        }),
      // The message names the fields there *are*, because the cause is almost
      // always a near-miss on one of them.
      (error: unknown) =>
        error instanceof ModelError && /publishedAt.*publishDate/s.test(error.message),
    );
  });

  it("accepts a default sort by a declared field, or by hand-arranged position", () => {
    const fields = { title: text(), slug: slug(), publishDate: date() };

    for (const field of ["publishDate", "title", "position"]) {
      assert.doesNotThrow(() =>
        defineSite({
          collections: {
            news: collection({ label: "News", defaultSort: { field, direction: "desc" }, fields }),
          },
        }),
      );
    }
  });
});

describe("listing order", () => {
  const news = collection({
    label: "News",
    defaultSort: { field: "publishDate", direction: "desc" },
    fields: { title: text(), slug: slug(), publishDate: date() },
  });

  const entry = (position: number, publishDate: string | null) => ({
    position,
    data: { title: `#${position}`, publishDate },
  });

  it("sorts by the field the collection names", () => {
    const entries = [
      entry(0, "2026-01-01"),
      entry(1, "2026-08-16"),
      entry(2, "2026-03-01"),
    ];

    assert.deepEqual(
      [...entries].sort(compareEntries(news)).map((e) => e.data.publishDate),
      ["2026-08-16", "2026-03-01", "2026-01-01"],
    );
  });

  it("puts entries with no value last, whichever way it is sorting", () => {
    const entries = [entry(0, null), entry(1, "2026-01-01"), entry(2, "2026-08-16")];

    const descending = [...entries].sort(compareEntries(news)).map((e) => e.data.publishDate);
    assert.deepEqual(descending, ["2026-08-16", "2026-01-01", null]);

    const ascending = [...entries]
      .sort(compareEntries({ ...news, defaultSort: { field: "publishDate", direction: "asc" } }))
      .map((e) => e.data.publishDate);

    // Not first, which is what a plain comparison would have done — an unfilled
    // date is not the oldest date.
    assert.deepEqual(ascending, ["2026-01-01", "2026-08-16", null]);
  });

  it("breaks ties on the hand-arranged order, so a list does not shuffle", () => {
    const sameDay = [entry(2, "2026-08-16"), entry(0, "2026-08-16"), entry(1, "2026-08-16")];

    assert.deepEqual(
      [...sameDay].sort(compareEntries(news)).map((e) => e.position),
      [0, 1, 2],
    );
  });

  it("falls back to that order when the collection asks for nothing", () => {
    const plain = collection({ label: "Pages", fields: { title: text(), slug: slug() } });
    const entries = [entry(2, null), entry(0, null), entry(1, null)];

    assert.deepEqual(
      [...entries].sort(compareEntries(plain)).map((e) => e.position),
      [0, 1, 2],
    );
  });

  it("compares numbers as numbers", () => {
    const projects = collection({
      label: "Projects",
      defaultSort: { field: "year", direction: "desc" },
      fields: { title: text(), slug: slug(), year: number() },
    });

    const entries = [
      { position: 0, data: { year: 9 } },
      { position: 1, data: { year: 100 } },
      { position: 2, data: { year: 20 } },
    ];

    // As strings, "9" would have sorted above "100".
    assert.deepEqual(
      [...entries].sort(compareEntries(projects)).map((e) => e.data.year),
      [100, 20, 9],
    );
  });
});

describe("model queries", () => {
  const projects = collection({
    label: "Projects",
    fields: {
      title: text(),
      slug: slug(),
      cover: media(),
      gallery: media({ multiple: true }),
      blocks: repeater({ fields: { image: media() } }),
      seo: object({ fields: { ogImage: media() } }),
    },
  });

  it("falls back through title, slug, then a placeholder", () => {
    assert.equal(entryTitle(projects, { title: "Haus A" }), "Haus A");
    assert.equal(entryTitle(projects, { title: "   ", slug: "haus-a" }), "haus-a");
    assert.equal(entryTitle(projects, {}), "Untitled");
  });

  it("collects media ids from every nesting level", () => {
    const ids = collectMediaIds(projects.fields, {
      cover: "a",
      gallery: ["b", "c"],
      blocks: [{ image: "d" }, { image: null }],
      seo: { ogImage: "e" },
    });
    assert.deepEqual(ids.sort(), ["a", "b", "c", "d", "e"]);
  });

  it("deduplicates repeated references", () => {
    const ids = collectMediaIds(projects.fields, { cover: "a", gallery: ["a", "a"] });
    assert.deepEqual(ids, ["a"]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptedFileTypes,
  acceptLabel,
  boolean,
  byCodeUnits,
  collection,
  color,
  compareEntries,
  coordinates,
  createManifest,
  date,
  defaultValues,
  defineSite,
  email,
  entryTitle,
  media,
  mapHosts,
  mediaFileTypeOf,
  ModelError,
  number,
  pageUrl,
  object,
  readManifest,
  relation,
  repeater,
  resolveMap,
  RICH_TEXT_TOOLBARS,
  richText,
  richTextFeatures,
  select,
  singleton,
  id,
  addressLocale,
  idAtPath,
  toId,
  text,
  type FieldMap,
  type InferFields,
  url,
  validateFields,
  withEmptyValues,
} from "../src/internal.js";

/* Type-level assertions — these fail at `rush typecheck`, not at runtime. */
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
type _Nested = Expect<Equal<Inferred["seo"], { metaTitle: string | null }>>;
type _Coordinates = Expect<Equal<Inferred["where"], { lat: number; lng: number; zoom?: number } | null>>;
/* eslint-enable @typescript-eslint/no-unused-vars */

describe("toId", () => {
  it("transliterates German umlauts rather than stripping them", () => {
    assert.equal(toId("Zürich Grünstrasse"), "zuerich-gruenstrasse");
    assert.equal(toId("Weißenbach"), "weissenbach");
  });

  it("strips accents and collapses separators", () => {
    assert.equal(toId("Café  de   Flore!"), "cafe-de-flore");
    assert.equal(toId("--Hello--World--"), "hello-world");
  });

  it("truncates on a word boundary", () => {
    assert.equal(toId("alpha beta gamma delta", 14), "alpha-beta");
  });

});

describe("validation", () => {
  // A kind from a newer @micacms/astro: reading must keep the value, the runtime locks the collection.
  it("keeps the value of a field kind this build does not know", () => {
    const fields = { title: text(), photos: { kind: "photoGrid" } } as unknown as FieldMap;
    const result = validateFields(fields, { title: "Summer", photos: { grid: [1, 2] } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.data["photos"], { grid: [1, 2] });
  });

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
    handle: id(),
    gallery: media({ multiple: true }),
    rows: repeater({ fields: { label: text({ required: true }) } }),
  };

  it("matches a text pattern against the whole value, by code point", () => {
    const code = { code: text({ pattern: "[A-Z]{2}" }), mark: text({ pattern: "." }) };
    assert.equal(validateFields(code, { code: "CH" }).ok, true);
    assert.equal(validateFields(code, { code: "CHE" }).ok, false);
    assert.equal(validateFields(code, { code: "xCH" }).ok, false);
    assert.equal(validateFields(code, { mark: "😀" }).ok, true);
  });

  it("keeps an alternation inside the anchors", () => {
    const either = { size: text({ pattern: "small|large" }) };
    assert.equal(validateFields(either, { size: "large" }).ok, true);
    assert.equal(validateFields(either, { size: "smaller" }).ok, false);
  });

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
      handle: "Not A Id",
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

  it("fills a missing value with the empty value on read, never with the default (#221)", () => {
    const stored = { title: "Old", unknown: "kept in the file" };
    const filled = withEmptyValues(fields, stored);
    assert.equal(filled.title, "Old");
    assert.equal(filled.live, false);
    assert.deepEqual(filled.seo, { metaTitle: null });
    assert.deepEqual(filled.rows, []);
    assert.equal("unknown" in filled, false);
    assert.equal(withEmptyValues(fields, {}).title, null);
  });

  it("fills inside existing repeater rows", () => {
    const filled = withEmptyValues(
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
        projects: collection({ label: "Projects", fields: { title: text(), id: id() } }),
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
              fields: { id: id(), author: relation({ collection: "tema" }) },
            }),
          },
        }),
      (error: unknown) =>
        error instanceof ModelError && /unknown collection "tema"/.test(error.message),
    );
  });

  // The shared media folder sits beside the folders of the collections and singletons.
  it("rejects a collection or a singleton named media", () => {
    const fields = { title: text(), id: id() };
    assert.throws(() => defineSite({ collections: { media: collection({ label: "Media", fields }) } }), /"media" is reserved/);
    assert.throws(
      () => defineSite({ collections: {}, singletons: { media: singleton({ label: "Media", fields: { title: text() } }) } }),
      /"media" is reserved/,
    );
  });

  it("rejects a collection without an ID field", () => {
    assert.throws(
      () =>
        defineSite({
          collections: { news: collection({ label: "News", fields: { title: text() } }) },
        }),
      ModelError,
    );
  });

  it("rejects an invalid text pattern when the model loads", () => {
    const site = (pattern: string) => () =>
      defineSite({
        collections: { news: collection({ label: "News", fields: { id: id(), code: text({ pattern }) } }) },
      });
    assert.throws(site("[A-Z"), /Text field "collections\.news\.code" has an invalid pattern/);
    // The `u` flag refuses an escape that a plain regular expression accepts.
    assert.throws(site("\\-"), ModelError);
  });

  it("rejects a text pattern that repeats a group that repeats inside", () => {
    const site = (pattern: string) => () =>
      defineSite({
        collections: { news: collection({ label: "News", fields: { id: id(), code: text({ pattern }) } }) },
      });
    for (const slow of ["(a+)+", "(a*)*", "(\\w+\\s?)+", "((ab)+c)*", "(?:a{2,})+", "(?<word>x+){2,}", "(a?)+"]) {
      assert.throws(site(slow), /has a pattern that can be very slow/, slow);
    }
    for (const safe of ["[A-Z]{2}", "(ab)+", "\\d{4}", "(-[0-9]+)?", "[(+)]+", "\\(a+\\)+", "\\p{L}+", "(?<year>[0-9]{4})", "(?:ab)*"]) {
      assert.doesNotThrow(site(safe), safe);
    }
    assert.throws(site("x(a+){3}"), /\(a\+\)\{3\} repeats a group/);
  });

  it("rejects an ID deriving from a non-existent sibling", () => {
    assert.throws(
      () =>
        defineSite({
          collections: {
            news: collection({ label: "News", fields: { id: id({ from: "titel" }) } }),
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
              // @ts-expect-error -- the types refuse it too; a model read from a manifest has no types.
              defaultSort: { field: "publishedAt", direction: "desc" },
              fields: { title: text(), id: id(), publishDate: date() },
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
    const fields = { title: text(), id: id(), publishDate: date() };

    for (const field of ["publishDate", "title", "position"] as const) {
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

describe("media paths (#213, N15)", () => {
  it("must stay inside the content root", () => {
    const fields = { cover: media() };
    assert.equal(validateFields(fields, { cover: "news/a/media/x.jpg" }).ok, true);
    const outside = validateFields(fields, { cover: "../../etc/passwd" });
    assert.equal(outside.ok, false);
    assert.match(outside.ok ? "" : outside.issues[0]!.message, /inside the content root/);
  });
});

describe("model checks (#222)", () => {
  const fields = { title: text(), id: id() };
  const throws = (build: () => unknown, pattern: RegExp) => assert.throws(build, (error: unknown) => error instanceof ModelError && pattern.test(error.message));

  it("refuse two names that differ only in case", () => {
    throws(() => defineSite({ collections: { teamMembers: collection({ label: "A", fields }), teammembers: collection({ label: "B", fields }) } }), /differ only in case/);
  });

  it("refuse an idField that is not an id", () => {
    throws(() => defineSite({ collections: { news: collection({ label: "News", idField: "title", fields }) } }), /not an id\(\) field/);
  });

  it("refuse a lower bound above the upper bound", () => {
    throws(() => defineSite({ collections: { news: collection({ label: "News", fields: { ...fields, size: number({ min: 5, max: 1 }) } }) } }), /min above/);
    throws(() => defineSite({ collections: { news: collection({ label: "News", fields: { ...fields, day: date({ min: "2026-12-01", max: "2026-01-01" }) } }) } }), /min date after/);
  });

  it("refuse a default that is not a valid value", () => {
    throws(
      () => defineSite({ collections: { news: collection({ label: "News", fields: { ...fields, kind: select({ options: [{ label: "A", value: "a" }], default: "b" }) } }) } }),
      /default of "collections.news.kind"/,
    );
  });
});

describe("the order of ids and dates", () => {
  it("sorts ids by code unit, the same on every machine", () => {
    assert.deepEqual(["b", "a-2", "a", "a10", "a1"].sort(byCodeUnits), ["a", "a-2", "a1", "a10", "b"]);
  });

  it("compares a date with a time as an instant, and a calendar bound by its day", () => {
    const at = date({ includeTime: true, max: "2026-01-01" });
    assert.equal(validateFields({ at }, { at: "2026-01-01T23:00:00+01:00" }).ok, true);
    assert.equal(validateFields({ at }, { at: "2026-01-02T00:30:00+01:00" }).ok, false);
  });
});

describe("listing order", () => {
  const news = collection({
    label: "News",
    defaultSort: { field: "publishDate", direction: "desc" },
    fields: { title: text(), id: id(), publishDate: date() },
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
    const plain = collection({ label: "Pages", fields: { title: text(), id: id() } });
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
      fields: { title: text(), id: id(), year: number() },
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
      id: id(),
      cover: media(),
      gallery: media({ multiple: true }),
      blocks: repeater({ fields: { image: media() } }),
      seo: object({ fields: { ogImage: media() } }),
    },
  });

  it("falls back through title, id, then a placeholder", () => {
    assert.equal(entryTitle(projects, { title: "Haus A" }), "Haus A");
    assert.equal(entryTitle(projects, { title: "   ", id: "haus-a" }), "haus-a");
    assert.equal(entryTitle(projects, {}), "Untitled");
  });
});

describe("page addresses", () => {
  const withUrl = (url: unknown, kind: "collection" | "singleton") => () =>
    kind === "collection"
      ? defineSite({ collections: { news: collection({ label: "News", url: url as string, fields: { title: text(), id: id({ from: "title" }) } }) } })
      : defineSite({ collections: {}, singletons: { about: singleton({ label: "About", url: url as string, fields: { title: text() } }) } });

  it("takes a path with {id} for a collection, and a path without one for a singleton", () => {
    assert.doesNotThrow(withUrl("/news/{id}", "collection"));
    assert.doesNotThrow(withUrl("/{id}/", "collection"));
    assert.doesNotThrow(withUrl("/about", "singleton"));
  });

  it("refuses an address that is not a path, or names the id wrongly", () => {
    for (const url of ["news/{id}", "//evil.example/{id}", "/news", "/news/{id}/{id}", "/news/{year}/{id}", "/news/{id}?x=1", "/news/{{id}", "/news/{id}}"]) {
      assert.throws(withUrl(url, "collection"), (error: unknown) => error instanceof ModelError && /has the url/.test(error.message), url);
    }
    assert.throws(withUrl("/team/{id}", "singleton"), ModelError);
  });

  it("fills in the id, encoded", () => {
    assert.equal(pageUrl("/news/{id}", "zürich"), "/news/z%C3%BCrich");
    assert.equal(pageUrl("/about"), "/about");
  });

  const tours = (url: string) => () =>
    defineSite({
      collections: {
        activities: collection({ label: "Activities", fields: { name: text(), id: id({ from: "name" }) } }),
        tours: collection({
          label: "Tours",
          url,
          fields: {
            title: text(),
            id: id({ from: "title" }),
            activity: relation({ collection: "activities" }),
            region: select({ options: [{ label: "Valais", value: "valais" }] }),
            startDate: date(),
            seen: date({ includeTime: true }),
            regions: relation({ collection: "activities", multiple: true }),
            notes: richText(),
          },
        }),
      },
    });

  it("takes a select, relation or date field beside {id}, each as a whole part of the path", () => {
    for (const url of ["/{activity}/{id}", "/{region}/{startDate}/{id}/", "/{activity}/x/tour-{id}"]) assert.doesNotThrow(tours(url), url);
  });

  it("refuses free text, a list, a time, a name that is no field, and a name that shares a part of the path", () => {
    const shared = ["/{activity}{id}", "/{startDate}-{id}", "/x-{activity}/{id}", "/{activity}"];
    for (const url of ["/{title}/{id}", "/{regions}/{id}", "/{notes}/{id}", "/{seen}/{id}", "/{nope}/{id}", ...shared]) {
      assert.throws(tours(url), (error: unknown) => error instanceof ModelError && /has the url/.test(error.message), url);
    }
  });

  it("fills in each field, and gives no page while one is empty", () => {
    assert.equal(pageUrl("/{activity}/{id}", "breithorn", { activity: "hochtouren" }), "/hochtouren/breithorn");
    assert.equal(pageUrl("/{activity}/{id}", "breithorn", { activity: null }), null);
    assert.equal(pageUrl("/{activity}/{id}", "breithorn"), null);
  });

  it("finds the id of a page, and how specific the address is", () => {
    assert.deepEqual(idAtPath("/{activity}/{id}", "/hochtouren/breithorn"), { id: "breithorn", locale: null, literal: 2 });
    assert.deepEqual(idAtPath("/news/{id}", "/news/z%C3%BCrich"), { id: "zürich", locale: null, literal: 6 });
    assert.equal(idAtPath("/{activity}/{id}", "/hochtouren"), null);
    assert.equal(idAtPath("/{activity}/{id}", "/a/b/c"), null);
    assert.equal(idAtPath("/news.{id}", "/newsXhello"), null, "the address's own text is literal");
    assert.deepEqual(idAtPath("/{activity}/tour-{id}", "/hochtouren/tour-piz-palue"), { id: "piz-palue", locale: null, literal: 7 });
    assert.equal(idAtPath("/news/{id}", "/news/100%"), null, "a stray % is no id");
  });

  describe("with {locale}", () => {
    const localized = (url: string, kind: "collection" | "singleton", locales = true) => () =>
      kind === "collection"
        ? defineSite({ ...(locales ? { locales: ["en", "de"] } : {}), collections: { news: collection({ label: "News", url, fields: { title: text(), id: id({ from: "title" }) } }) } })
        : defineSite({ ...(locales ? { locales: ["en", "de"] } : {}), collections: {}, singletons: { home: singleton({ label: "Home", url, fields: { title: text() } }) } });
    const site = { locales: ["en", "de", "de-ch"], defaultLocale: "en" };
    const prefixed = { ...site, prefixDefaultLocale: true };

    it("takes {locale} once, as a whole part of the path, on a site with locales, also for a singleton", () => {
      assert.doesNotThrow(localized("/{locale}/news/{id}/", "collection"));
      assert.doesNotThrow(localized("/news/{locale}/{id}", "collection"));
      assert.doesNotThrow(localized("/{locale}/", "singleton"));
      for (const url of ["/{locale}-{id}", "/{locale}/{locale}/{id}", "/x{locale}/{id}"]) {
        assert.throws(localized(url, "collection"), (error: unknown) => error instanceof ModelError && /has the url/.test(error.message), url);
      }
      assert.throws(localized("/{locale}/news/{id}", "collection", false), /needs the site's locales/);
    });

    it("is a field on a site without locales, and an error beside a field locale on a site with them", () => {
      const withField = (locales: boolean) => () =>
        defineSite({
          ...(locales ? { locales: ["en", "de"] } : {}),
          collections: {
            news: collection({
              label: "News",
              url: "/{locale}/{id}",
              fields: { title: text(), id: id({ from: "title" }), locale: select({ options: [{ label: "English", value: "en" }] }) },
            }),
          },
        });
      assert.doesNotThrow(withField(false));
      assert.throws(withField(true), /rename the field "locale"/);
      assert.equal(pageUrl("/{locale}/{id}", "hello", { locale: "en" }), "/en/hello", "without a locale, {locale} is the field");
      assert.equal(addressLocale({}, "en"), undefined, "a site without locales has no locale in its addresses");
      assert.deepEqual(idAtPath("/{locale}/{id}", "/en/hello"), { id: "hello", locale: null, literal: 2 });
    });

    it("fills and finds {locale} in the middle of the path", () => {
      assert.equal(pageUrl("/news/{locale}/{id}/", "hello", {}, "de"), "/news/de/hello/");
      assert.equal(pageUrl("/news/{locale}/{id}/", "hello", {}, ""), "/news/hello/");
      assert.deepEqual(idAtPath("/news/{locale}/{id}", "/news/de/hello", site), { id: "hello", locale: "de", literal: 6 });
      assert.deepEqual(idAtPath("/news/{locale}/{id}", "/news/hello", site), { id: "hello", locale: "en", literal: 6 });
    });

    it("keeps prefixDefaultLocale and {locale} through the manifest, and leaves out such a url without locales", () => {
      const model = defineSite({ locales: ["en", "de"], prefixDefaultLocale: true, collections: { news: collection({ label: "News", url: "/{locale}/news/{id}", fields: { title: text(), id: id({ from: "title" }) } }) } });
      const read = readManifest(JSON.parse(JSON.stringify(createManifest(model, "test"))));
      assert.equal(read.site.prefixDefaultLocale, true);
      assert.equal(read.site.collections.news!.url, "/{locale}/news/{id}");
      const manifest = JSON.parse(JSON.stringify(createManifest(model, "test")));
      delete manifest.locales;
      delete manifest.defaultLocale;
      delete manifest.prefixDefaultLocale;
      const older = readManifest(manifest);
      assert.equal(older.site.collections.news!.url, undefined);
      assert.ok(older.warnings.some((warning) => warning.includes("/{locale}/news/{id}")));
    });

    it("refuses prefixDefaultLocale that is no boolean, or without locales", () => {
      assert.throws(() => defineSite({ locales: ["en"], prefixDefaultLocale: "yes" as unknown as boolean, collections: {} }), /true or false/);
      assert.throws(() => defineSite({ prefixDefaultLocale: true, collections: {} }), /needs `locales`/);
      assert.doesNotThrow(() => defineSite({ prefixDefaultLocale: false, collections: {} }));
      assert.equal(defineSite({ locales: ["en"], prefixDefaultLocale: true, collections: {} }).prefixDefaultLocale, true);
    });

    it("leaves out the default locale without a prefix", () => {
      assert.equal(addressLocale(site, "en"), "");
      assert.equal(addressLocale(site, undefined), "");
      assert.equal(addressLocale(site, "de-ch"), "de-ch");
      assert.equal(addressLocale(prefixed, undefined), "en");
      assert.equal(pageUrl("/{locale}/news/{id}/", "hello", {}, ""), "/news/hello/");
      assert.equal(pageUrl("/{locale}/news/{id}/", "hello", {}, "de"), "/de/news/hello/");
      assert.equal(pageUrl("/{locale}/", undefined, {}, ""), "/");
      assert.equal(pageUrl("/{locale}/", undefined, {}, "de"), "/de/");
      assert.equal(pageUrl("/{locale}", undefined, {}, ""), "/");
    });

    it("finds the locale of a page, the default locale without a prefix", () => {
      assert.deepEqual(idAtPath("/{locale}/news/{id}", "/news/hello", site), { id: "hello", locale: "en", literal: 6 });
      assert.deepEqual(idAtPath("/{locale}/news/{id}", "/de-ch/news/hello", site), { id: "hello", locale: "de-ch", literal: 6 });
      assert.equal(idAtPath("/{locale}/news/{id}", "/en/news/hello", site), null, "the default locale has no prefix");
      assert.equal(idAtPath("/{locale}/news/{id}", "/fr/news/hello", site), null, "not a locale of the site");
      assert.deepEqual(idAtPath("/{locale}/news/{id}", "/en/news/hello", prefixed), { id: "hello", locale: "en", literal: 6 });
      assert.equal(idAtPath("/{locale}/news/{id}", "/news/hello", prefixed), null);
      assert.deepEqual(idAtPath("/{locale}", "/", site), { id: "", locale: "en", literal: 0 });
      assert.deepEqual(idAtPath("/{locale}", "/de", site), { id: "", locale: "de", literal: 0 });
    });
  });
});

describe("media file types", () => {
  const withAccept = (accept: unknown) => () =>
    defineSite({ collections: { tours: collection({ label: "Tours", fields: { title: text(), id: id({ from: "title" }), track: media({ accept: accept as never }) } }) } });

  it("takes a group or a list of known types", () => {
    for (const accept of ["image", "document", "any", ["gpx"], ["gpx", "kml", "image"]]) assert.doesNotThrow(withAccept(accept));
  });

  it("refuses an unknown type, an empty list or a repeated type when the model loads", () => {
    for (const accept of ["video", ["gpx", "mp4"], [], ["gpx", "gpx"]]) {
      assert.throws(withAccept(accept), (error: unknown) => error instanceof ModelError && /unknown accept/.test(error.message));
    }
  });

  it("resolves a group to its types, and a detected type to its name", () => {
    assert.deepEqual(acceptedFileTypes("document"), ["pdf"]);
    assert.deepEqual(acceptedFileTypes(undefined), acceptedFileTypes("any"));
    assert.ok(acceptedFileTypes("any").includes("gpx"));
    assert.equal(mediaFileTypeOf("image/webp"), "image");
    assert.equal(mediaFileTypeOf("text/html"), undefined);
    assert.equal(acceptLabel(["gpx", "kml", "pdf"]), "GPX tracks, KML files or PDF documents");
  });
});

describe("rich-text toolbars", () => {
  it("gives the features of a preset, a list as it is, and the default without one", () => {
    assert.deepEqual(richTextFeatures("minimal"), ["bold", "italic", "link"]);
    assert.deepEqual(richTextFeatures(undefined), RICH_TEXT_TOOLBARS.default);
    assert.ok(richTextFeatures("full").includes("table") && richTextFeatures("full").includes("image"));
    assert.deepEqual(richTextFeatures(["bold", "image"]), ["bold", "image"]);
  });

  it("refuses an unknown preset or feature when the model loads", () => {
    for (const toolbar of ["maximal", ["bold", "underline"]]) {
      assert.throws(
        () => defineSite({ collections: { news: collection({ label: "News", fields: { body: richText({ toolbar: toolbar as never }) } }) } }),
        (error: unknown) => error instanceof ModelError && /unknown toolbar/.test(error.message),
      );
    }
  });
});

describe("coordinates maps", () => {
  const siteWith = (fields: FieldMap) =>
    defineSite({ collections: { places: collection({ label: "Places", fields: { title: text(), id: id({ from: "title" }), ...fields } }) } });

  it("loads a preset from OpenFreeMap, and a style of its own from its origin and its hosts", () => {
    assert.deepEqual(resolveMap("positron"), {
      style: "https://tiles.openfreemap.org/styles/positron",
      hosts: ["https://tiles.openfreemap.org"],
      preset: "positron",
    });
    assert.deepEqual(resolveMap({ style: "https://maps.example.com/style.json?key=abc", hosts: ["https://tiles.example.com", "https://maps.example.com"] }), {
      style: "https://maps.example.com/style.json?key=abc",
      hosts: ["https://maps.example.com", "https://tiles.example.com"],
      preset: null,
    });
  });

  it("collects the hosts of every map, nested fields included, and none without a map", () => {
    assert.deepEqual(mapHosts(siteWith({ where: coordinates() })), []);
    const site = siteWith({
      where: coordinates({ map: "liberty" }),
      stops: repeater({ fields: { at: coordinates({ map: { style: "https://maps.example.com/style.json", hosts: ["https://tiles.example.com"] } }) } }),
      office: object({ fields: { at: coordinates({ map: "bright" }) } }),
    });
    assert.deepEqual(mapHosts(site), ["https://maps.example.com", "https://tiles.example.com", "https://tiles.openfreemap.org"]);
  });

  it("refuses an unknown preset, an address that is not https, and a host that is not an origin", () => {
    const maps: unknown[] = [
      "satellite",
      { style: "http://maps.example.com/style.json" },
      { style: "not an address" },
      { style: "https://maps.example.com/style.json", hosts: ["http://tiles.example.com"] },
      { style: "https://maps.example.com/style.json", hosts: ["https://tiles.example.com/tiles"] },
      { style: "https://maps.example.com/style.json", hosts: "https://tiles.example.com" },
    ];
    for (const map of maps) {
      assert.throws(
        () => siteWith({ where: coordinates({ map: map as never }) }),
        (error: unknown) => error instanceof ModelError && /invalid map/.test(error.message),
        JSON.stringify(map),
      );
    }
  });
});

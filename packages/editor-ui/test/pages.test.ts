/** Links to the website (#103): from the model's `url` and `MICA_SITE_URL`, and nothing without them. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Schema } from "../src/api.js";
import { documentAtPath, documentsAtPath, entryAddress, movedPage, pageAddress, pageHref, pageOfOwner } from "../src/lib/pages.js";

const schema = {
  collections: [{ name: "news", page: "https://example.com/news/{id}" }, { name: "team", page: null }],
  singletons: [{ name: "about", page: "https://example.com/about" }],
} as unknown as Schema;

describe("pages on the website", () => {
  it("fills in the id, encoded", () => {
    assert.equal(pageHref("https://example.com/news/{id}", "hello"), "https://example.com/news/hello");
    assert.equal(pageHref(null, "hello"), null);
  });

  it("finds the page of an entry and of a singleton, and none for the rest", () => {
    assert.equal(pageOfOwner({ kind: "entry", collection: "news", id: "launch", label: "Launch" }, schema), "https://example.com/news/launch");
    assert.equal(pageOfOwner({ kind: "entry", collection: "team", id: "ada", label: "Ada" }, schema), null);
    assert.equal(pageOfOwner({ kind: "singleton", name: "about", label: "About" }, schema), "https://example.com/about");
    assert.equal(pageOfOwner({ kind: "media", label: "photo.jpg" }, schema), null);
  });

  it("fills in the other fields of an address from the entry's data, and gives no page without them", () => {
    const tours = { collections: [{ name: "tours", page: "https://example.com/{activity}/{id}" }], singletons: [] } as unknown as Schema;
    const owner = { kind: "entry", collection: "tours", id: "breithorn", label: "Breithorn" } as const;
    assert.equal(pageOfOwner(owner, tours, { activity: "hochtouren" }), "https://example.com/hochtouren/breithorn");
    assert.equal(pageOfOwner(owner, tours), null, "the Publish page before the comparison loaded");
    assert.equal(pageHref("https://example.com/{activity}/{id}", "breithorn", { activity: "" }), null);
  });
});

describe("the document of a preview page", () => {
  const schema = {
    collections: [
      { name: "pages", url: "/{id}/" },
      { name: "news", url: "/news/{id}/" },
      { name: "team", url: null },
    ],
    singletons: [
      { name: "homePage", url: "/" },
      { name: "labels", url: null },
    ],
  } as unknown as Schema;

  it("finds the entry or the settings whose page it is, the most specific address first", () => {
    assert.deepEqual(documentAtPath("/news/hello/", schema), { name: "entry", params: { collection: "news", id: "hello" }, locale: null });
    assert.deepEqual(documentAtPath("/news", schema), { name: "entry", params: { collection: "pages", id: "news" }, locale: null });
    assert.deepEqual(documentAtPath("/", schema), { name: "singleton", params: { name: "homePage" }, locale: null });
    assert.deepEqual(documentAtPath("/gr%C3%BCezi/", schema), { name: "entry", params: { collection: "pages", id: "grüezi" }, locale: null });
  });

  it("matches each other field of an address with one part of the path", () => {
    const withTours = { ...schema, collections: [...schema.collections, { name: "tours", url: "/{activity}/{id}" }] } as unknown as Schema;
    assert.deepEqual(documentAtPath("/hochtouren/breithorn/", withTours), { name: "entry", params: { collection: "tours", id: "breithorn" }, locale: null });
    assert.deepEqual(documentAtPath("/news/hello", withTours), { name: "entry", params: { collection: "news", id: "hello" }, locale: null }, "its own text makes /news/{id} more specific");
    assert.deepEqual(documentAtPath("/hochtouren", withTours), { name: "entry", params: { collection: "pages", id: "hochtouren" }, locale: null });
  });

  it("gives every document that the path can be, the most specific first, for addresses that are equally specific", () => {
    const both = { collections: [{ name: "tours", url: "/{activity}/{id}" }, { name: "news", url: "/{year}/{id}" }, { name: "pages", url: "/{id}" }], singletons: [] } as unknown as Schema;
    assert.deepEqual(
      documentsAtPath("/2026/launch", both).map((document) => document.params["collection"]),
      ["tours", "news"],
      "the preview takes the first one whose entry the page shows",
    );
  });

  it("finds the locale of a page with {locale}, the default locale without a prefix", () => {
    const localized = {
      site: { locales: { list: ["en", "de"], default: "en", fallback: {}, prefixDefault: false } },
      collections: [{ name: "news", url: "/{locale}/news/{id}/" }, { name: "pages", url: "/{locale}/{id}/" }],
      singletons: [{ name: "homePage", url: "/{locale}/" }],
    } as unknown as Schema;
    assert.deepEqual(documentAtPath("/de/news/hello/", localized), { name: "entry", params: { collection: "news", id: "hello" }, locale: "de" });
    assert.deepEqual(documentAtPath("/news/hello/", localized), { name: "entry", params: { collection: "news", id: "hello" }, locale: "en" });
    assert.deepEqual(documentAtPath("/", localized), { name: "singleton", params: { name: "homePage" }, locale: "en" });
    assert.deepEqual(
      documentsAtPath("/de/", localized).map((document) => [document.name, document.locale]),
      [["singleton", "de"], ["entry", "en"]],
      "the German home page, before a page with the ID de",
    );
    assert.equal(pageHref("/{locale}/news/{id}/", "hello", {}, "de"), "/de/news/hello/");
    assert.deepEqual(pageAddress("/{locale}/news/{id}/", {}, (name) => name, "de"), { before: "/de/news/", after: "/", missing: [] });
  });

  it("gives null for a page without a document of its own", () => {
    assert.equal(documentAtPath("/news/2026/hello/", schema), null);
    assert.equal(documentAtPath("/sitemap.xml/x/", schema), null);
  });
});

describe("the address around an ID field", () => {
  const labels: Record<string, string> = { activity: "Activity", region: "Region" };
  const labelOf = (name: string) => labels[name] ?? name;

  it("is the text of the url before and after {id}, with the other fields of the form", () => {
    assert.deepEqual(pageAddress("/news/{id}/", {}, labelOf), { before: "/news/", after: "/", missing: [] });
    assert.deepEqual(pageAddress("/{activity}/{id}", { activity: "hochtouren" }, labelOf), { before: "/hochtouren/", after: "", missing: [] });
  });

  it("names an empty field by its label, because the page has no address without it", () => {
    assert.deepEqual(pageAddress("/{region}/{activity}/{id}", { activity: "" }, labelOf), {
      before: "/‹Region›/‹Activity›/",
      after: "",
      missing: ["Region", "Activity"],
    });
  });
});

describe("what a list shows for an entry", () => {
  it("is the page's URL with the entry's fields, else its ID", () => {
    assert.equal(entryAddress("/{activity}/{id}", "breithorn", { activity: "hochtouren" }), "/hochtouren/breithorn");
    assert.equal(entryAddress("/{activity}/{id}", "breithorn", {}), "breithorn", "an incomplete address gives the ID");
    assert.equal(entryAddress(null, "breithorn", {}), "breithorn", "a collection without a url");
  });
});

describe("where a page moves with a new ID", () => {
  it("is the old address with the saved data and the new one with the form's", () => {
    assert.deepEqual(movedPage("/{activity}/{id}", { id: "breithorn", data: { activity: "hochtouren" } }, { id: "breithorn-ost", data: { activity: "skitouren" } }), {
      from: "/hochtouren/breithorn",
      to: "/skitouren/breithorn-ost",
    });
    assert.equal(movedPage(null, { id: "a", data: {} }, { id: "b", data: {} }), null, "no url, no page");
    assert.equal(movedPage("/news/{id}/", { id: "a", data: {} }, { id: "", data: {} }), null, "an empty new ID");
  });
});


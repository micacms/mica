/** Links to the website (#103): from the model's `url` and `MICA_SITE_URL`, and nothing without them. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Schema } from "../src/api.js";
import { documentAtPath, documentsAtPath, pageHref, pageOfOwner, slugAddress } from "../src/lib/pages.js";

const schema = {
  collections: [{ name: "news", page: "https://example.com/news/{slug}" }, { name: "team", page: null }],
  singletons: [{ name: "about", page: "https://example.com/about" }],
} as unknown as Schema;

describe("pages on the website", () => {
  it("fills in the slug, encoded", () => {
    assert.equal(pageHref("https://example.com/news/{slug}", "hello"), "https://example.com/news/hello");
    assert.equal(pageHref(null, "hello"), null);
  });

  it("finds the page of an entry and of a singleton, and none for the rest", () => {
    assert.equal(pageOfOwner({ kind: "entry", collection: "news", slug: "launch", label: "Launch" }, schema), "https://example.com/news/launch");
    assert.equal(pageOfOwner({ kind: "entry", collection: "team", slug: "ada", label: "Ada" }, schema), null);
    assert.equal(pageOfOwner({ kind: "singleton", name: "about", label: "About" }, schema), "https://example.com/about");
    assert.equal(pageOfOwner({ kind: "media", label: "photo.jpg" }, schema), null);
  });

  it("fills in the other fields of an address from the entry's data, and gives no page without them", () => {
    const tours = { collections: [{ name: "tours", page: "https://example.com/{activity}/{slug}" }], singletons: [] } as unknown as Schema;
    const owner = { kind: "entry", collection: "tours", slug: "breithorn", label: "Breithorn" } as const;
    assert.equal(pageOfOwner(owner, tours, { activity: "hochtouren" }), "https://example.com/hochtouren/breithorn");
    assert.equal(pageOfOwner(owner, tours), null, "the Publish page before the comparison loaded");
    assert.equal(pageHref("https://example.com/{activity}/{slug}", "breithorn", { activity: "" }), null);
  });
});

describe("the document of a preview page", () => {
  const schema = {
    collections: [
      { name: "pages", url: "/{slug}/" },
      { name: "news", url: "/news/{slug}/" },
      { name: "team", url: null },
    ],
    singletons: [
      { name: "homePage", url: "/" },
      { name: "labels", url: null },
    ],
  } as unknown as Schema;

  it("finds the entry or the settings whose page it is, the most specific address first", () => {
    assert.deepEqual(documentAtPath("/news/hello/", schema), { name: "entry", params: { collection: "news", slug: "hello" } });
    assert.deepEqual(documentAtPath("/news", schema), { name: "entry", params: { collection: "pages", slug: "news" } });
    assert.deepEqual(documentAtPath("/", schema), { name: "singleton", params: { name: "homePage" } });
    assert.deepEqual(documentAtPath("/gr%C3%BCezi/", schema), { name: "entry", params: { collection: "pages", slug: "grüezi" } });
  });

  it("matches each other field of an address with one part of the path", () => {
    const withTours = { ...schema, collections: [...schema.collections, { name: "tours", url: "/{activity}/{slug}" }] } as unknown as Schema;
    assert.deepEqual(documentAtPath("/hochtouren/breithorn/", withTours), { name: "entry", params: { collection: "tours", slug: "breithorn" } });
    assert.deepEqual(documentAtPath("/news/hello", withTours), { name: "entry", params: { collection: "news", slug: "hello" } }, "its own text makes /news/{slug} more specific");
    assert.deepEqual(documentAtPath("/hochtouren", withTours), { name: "entry", params: { collection: "pages", slug: "hochtouren" } });
  });

  it("gives every document that the path can be, the most specific first, for addresses that are equally specific", () => {
    const both = { collections: [{ name: "tours", url: "/{activity}/{slug}" }, { name: "news", url: "/{year}/{slug}" }, { name: "pages", url: "/{slug}" }], singletons: [] } as unknown as Schema;
    assert.deepEqual(
      documentsAtPath("/2026/launch", both).map((document) => document.params["collection"]),
      ["tours", "news"],
      "the preview takes the first one whose entry the page shows",
    );
  });

  it("gives null for a page without a document of its own", () => {
    assert.equal(documentAtPath("/news/2026/hello/", schema), null);
    assert.equal(documentAtPath("/sitemap.xml/x/", schema), null);
  });
});

describe("the address around a slug field", () => {
  const labels: Record<string, string> = { activity: "Activity", region: "Region" };
  const labelOf = (name: string) => labels[name] ?? name;

  it("is the text of the url before and after {slug}, with the other fields of the form", () => {
    assert.deepEqual(slugAddress("/news/{slug}/", {}, labelOf), { before: "/news/", after: "/", missing: [] });
    assert.deepEqual(slugAddress("/{activity}/{slug}", { activity: "hochtouren" }, labelOf), { before: "/hochtouren/", after: "", missing: [] });
  });

  it("names an empty field by its label, because the page has no address without it", () => {
    assert.deepEqual(slugAddress("/{region}/{activity}/{slug}", { activity: "" }, labelOf), {
      before: "/‹Region›/‹Activity›/",
      after: "",
      missing: ["Region", "Activity"],
    });
  });
});

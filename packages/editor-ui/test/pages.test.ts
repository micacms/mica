/** Links to the website (#103): from the model's `url` and `MICA_SITE_URL`, and nothing without them. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Schema } from "../src/api.js";
import { documentAtPath, pageHref, pageOfOwner } from "../src/lib/pages.js";

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

  it("gives null for a page without a document of its own", () => {
    assert.equal(documentAtPath("/news/2026/hello/", schema), null);
    assert.equal(documentAtPath("/sitemap.xml/x/", schema), null);
  });
});

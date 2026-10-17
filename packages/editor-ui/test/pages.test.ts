/** Links to the website (#103): from the model's `url` and `MICA_SITE_URL`, and nothing without them. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Schema } from "../src/api.js";
import { pageHref, pageOfOwner } from "../src/lib/pages.js";

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

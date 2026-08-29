/** The one thing this package promises: the old name still answers. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collection, defineSite, slug, text } from "../dist/index.js";
import { fileSystemSource } from "../dist/node.js";

describe("@micacms/model, the re-export", () => {
  it("still defines a site", () => {
    const site = defineSite({
      collections: {
        news: collection({
          label: "News",
          fields: { title: text({ label: "Title" }), slug: slug({ from: "title" }) },
        }),
      },
    });

    assert.ok(site.collections.news);
  });

  it("still carries the node entry point", () => {
    assert.equal(typeof fileSystemSource, "function");
  });
});

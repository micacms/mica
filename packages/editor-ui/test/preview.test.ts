/** The live preview: the label of a field on hover, and which fields have unpublished changes. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { object, relation, repeater, text } from "@micacms/core/internal";

import type { Edit } from "../src/lib/edits.js";
import { fieldLabel } from "../src/lib/field-labels.js";
import { changedMarkers } from "../src/lib/preview-changes.js";
import { linkKey, relationLinks } from "../src/lib/preview-relations.js";

describe("preview field labels", () => {
  const fields = {
    title: text({ label: "Headline" }),
    metaTitle: text(),
    seo: object({ fields: { description: text({ label: "Description" }) } }),
    facts: repeater({ fields: { label: text({ label: "Fact" }) } }),
  };

  it("names a field as the form does, also in objects and rows", () => {
    assert.equal(fieldLabel(fields, "title"), "Headline");
    assert.equal(fieldLabel(fields, "metaTitle"), "Meta title");
    assert.equal(fieldLabel(fields, "seo.description"), "Description");
    assert.equal(fieldLabel(fields, "facts.2.label"), "Fact");
  });

  it("gives null for a path that the model does not have", () => {
    assert.equal(fieldLabel(fields, "subtitle"), null);
    assert.equal(fieldLabel(fields, "title.more"), null);
  });
});

describe("changed preview fields", () => {
  const edit = (target: Edit["target"], state: Edit["state"]): Edit => ({
    key: "k",
    label: "",
    link: null,
    fileChanges: [],
    target,
    state,
    savedAt: null,
    needs: [],
  });

  it("marks every field of a new entry, and none of a document without a pending edit", async () => {
    const markers = [
      { document: "news", id: "hello", path: "title" },
      { document: "news", id: "other", path: "title" },
      { document: "navigation", id: "navigation", path: "items.0.label" },
    ];
    const changed = await changedMarkers(markers, [edit({ kind: "entry", collection: "news", slug: "hello" }, "new")]);
    assert.deepEqual(changed, [markers[0]]);
  });
});

describe("the entries that a document links to", () => {
  const fields = {
    author: relation({ collection: "team", label: "Author" }),
    team: relation({ collection: "team", multiple: true }),
    facts: repeater({ fields: { source: relation({ collection: "news", label: "Source" }) } }),
  };

  it("gives each linked entry its relation field, with its place in a list, the first field first", () => {
    const links = relationLinks(fields, { author: "amara", team: ["lars", "amara"], facts: [{ source: "hello" }] });
    assert.deepEqual(links.get(linkKey("team", "amara")), { path: "author", label: "Author" });
    assert.deepEqual(links.get(linkKey("team", "lars")), { path: "team", label: "Team", block: 0 });
    assert.deepEqual(links.get(linkKey("news", "hello")), { path: "facts.0.source", label: "Source" });
    assert.equal(links.size, 3);
  });
});

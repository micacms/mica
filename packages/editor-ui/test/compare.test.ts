/**
 * The before/after row builder for the Publish page.
 *
 * Pure data in, rows out: what the editor sees is decided here, so what the
 * editor sees is what these tests pin down.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boolean,
  collection,
  defineSite,
  media,
  object,
  repeater,
  richText,
  select,
  slug,
  text,
} from "@micacms/core";

import { compareRows, displayValue } from "../src/lib/compare.js";

const site = defineSite({
  collections: {
    pages: collection({
      label: "Pages",
      fields: {
        title: text({ label: "Title", required: true }),
        slug: slug({ from: "title" }),
        body: richText(),
        published: boolean({ label: "Published" }),
        category: select({
          options: [
            { label: "News", value: "news" },
            { label: "Opinion", value: "opinion" },
          ],
        }),
        hero: media({ accept: "image" }),
        seo: object({
          label: "SEO",
          fields: { metaTitle: text({ label: "Meta title" }) },
        }),
        sections: repeater({
          label: "Extra sections",
          itemLabel: "heading",
          fields: {
            heading: text({ label: "Heading", required: true }),
            text: richText(),
          },
        }),
      },
    }),
  },
});

const fields = site.collections["pages"]!.fields;

describe("compareRows", () => {
  it("keeps only the fields whose value changed, in model order", () => {
    const rows = compareRows(
      fields,
      { title: "Services", published: true, category: "news" },
      { title: "Our services", published: true, category: "opinion" },
    );

    assert.deepEqual(
      rows.map((row) => row.label.join(" › ")),
      ["Title", "Category"],
    );
    assert.equal(rows[0]?.before, "Services");
    assert.equal(rows[0]?.after, "Our services");
  });

  it("walks into objects and repeaters with breadcrumb labels", () => {
    const rows = compareRows(
      fields,
      {
        seo: { metaTitle: "Old" },
        sections: [{ heading: "Team", text: "We are three.\n" }],
      },
      {
        seo: { metaTitle: "New" },
        sections: [
          { heading: "Team", text: "We are four.\n" },
          { heading: "History", text: null },
        ],
      },
    );

    assert.deepEqual(
      rows.map((row) => row.label.join(" › ")),
      ["SEO › Meta title", "Extra sections › Team › Text", "Extra sections › History › Heading"],
    );
    // The added repeater item reads as Empty → value, not as JSON.
    assert.equal(rows[2]?.before, "Empty");
    assert.equal(rows[2]?.after, "History");
  });

  it("a created document has no before side, a deleted one no after", () => {
    const created = compareRows(fields, null, { title: "New page" });
    assert.equal(created[0]?.before, null);
    assert.equal(created[0]?.after, "New page");

    const deleted = compareRows(fields, { title: "Old page" }, null);
    assert.equal(deleted[0]?.before, "Old page");
    assert.equal(deleted[0]?.after, null);
  });

  it("says values the way the field would, never as JSON", () => {
    assert.equal(displayValue(fields["published"]!, true), "Yes");
    assert.equal(displayValue(fields["published"]!, false), "No");
    assert.equal(displayValue(fields["category"]!, "news"), "News");
    assert.equal(displayValue(fields["hero"]!, "media/team-photo.jpg"), "team-photo.jpg");
    assert.equal(
      displayValue(media({ alt: "optional", multiple: true }), [{ path: "media/a.jpg", alt: "A house" }, { path: "media/b.jpg", alt: null }]),
      'a.jpg ("A house"), b.jpg',
    );
    assert.equal(displayValue(fields["title"]!, null), "Empty");
  });
});

/** `collectReferences`: what Publish and the delete warning check, nested fields included. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectReferences,
  markdocImages,
  markdocTargets,
  media,
  object,
  relation,
  relinkReferences,
  repeater,
  resolveMarkdocTarget,
  richText,
  richTextValues,
  text,
} from "../dist/index.js";

const fields = {
  title: text(),
  author: relation({ collection: "team" }),
  reviewers: relation({ collection: "team", multiple: true }),
  cover: media({ alt: "optional" }),
  seo: object({ fields: { image: media() } }),
  sections: repeater({ fields: { contact: relation({ collection: "team" }), photos: media({ multiple: true }) } }),
};

describe("collectReferences", () => {
  it("finds relations and media at every level, with the field's path", () => {
    const found = collectReferences(fields, {
      title: "Hello",
      author: "anna",
      reviewers: ["bob", ""],
      cover: { path: "news/hello/media/a.jpg", alt: null },
      seo: { image: "media/og.png" },
      sections: [{ contact: "carla", photos: ["news/hello/media/b.jpg"] }, { contact: null, photos: [] }],
    });

    assert.deepEqual(found, [
      { kind: "relation", field: "author", collection: "team", slug: "anna" },
      { kind: "relation", field: "reviewers.0", collection: "team", slug: "bob" },
      { kind: "media", field: "cover", path: "news/hello/media/a.jpg" },
      { kind: "media", field: "seo.image", path: "media/og.png" },
      { kind: "relation", field: "sections.0.contact", collection: "team", slug: "carla" },
      { kind: "media", field: "sections.0.photos.0", path: "news/hello/media/b.jpg" },
    ]);
  });

  it("finds nothing in an empty payload", () => {
    assert.deepEqual(collectReferences(fields, {}), []);
  });
});

describe("relinkReferences", () => {
  const fields = {
    author: relation({ collection: "team" }),
    others: relation({ collection: "team", multiple: true }),
    place: relation({ collection: "places" }),
    meta: object({ fields: { editor: relation({ collection: "team" }) } }),
    steps: repeater({ fields: { contact: relation({ collection: "team" }) } }),
  };

  it("points every relation to the old slug at the new one, nested fields included", () => {
    const data = { author: "anna", others: ["ben", "anna"], place: "anna", meta: { editor: "anna" }, steps: [{ contact: "anna" }, { contact: "ben" }] };
    assert.deepEqual(relinkReferences(fields, data, "team", "anna", "anna-meier"), {
      author: "anna-meier",
      others: ["ben", "anna-meier"],
      place: "anna",
      meta: { editor: "anna-meier" },
      steps: [{ contact: "anna-meier" }, { contact: "ben" }],
    });
  });

  it("returns null when nothing pointed at the old slug", () => {
    assert.equal(relinkReferences(fields, { author: "ben", others: [], steps: [] }, "team", "anna", "x"), null);
  });
});

describe("paths in rich text", () => {
  it("finds the images and links of every rich-text value, nested ones included", () => {
    const model = { body: richText(), sections: repeater({ fields: { text: richText() } }) };
    const texts = richTextValues(model, { body: "![A](media/a.jpg)", sections: [{ text: "[Prices](/media/prices.pdf)" }] });
    assert.deepEqual(texts.flatMap(markdocTargets), ["media/a.jpg", "/media/prices.pdf"]);
  });

  it("finds the images, and not the links", () => {
    assert.deepEqual(markdocImages("![A \\] b](media/a.jpg)\n\n[Link](/media/b.pdf) ![](</media/c.png>)"), ["media/a.jpg", "/media/c.png"]);
  });

  it("reads a path from the document's folder, or from the content root with a slash", () => {
    assert.equal(resolveMarkdocTarget("media/a.jpg", "news/hello"), "news/hello/media/a.jpg");
    assert.equal(resolveMarkdocTarget("/media/logo.png", "news/hello"), "media/logo.png");
    assert.equal(resolveMarkdocTarget("./media/../media/a%20b.jpg", "news/hello"), "news/hello/media/a b.jpg");
  });

  it("is not a content path for an address, an anchor, or a path above the content root", () => {
    for (const target of ["https://example.com/a.jpg", "mailto:hi@example.com", "#top", "../../../etc/passwd"]) {
      assert.equal(resolveMarkdocTarget(target, "news/hello"), null, target);
    }
  });
});

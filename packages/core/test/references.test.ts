/** `documentLinks`: what Publish, the media uses and the delete warning check, nested fields included. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createManifest,
  createReferenceCheck,
  defineSite,
  documentLinks,
  mapFields,
  ownerOfPath,
  walkFields,
  ModelError,
  parseReferenceIndex,
  readManifest,
  referenceIndexPath,
  referenceSet,
  serializeReferenceIndex,
  collection,
  isWebAddress,
  memorySource,
  markdocImages,
  markdocTargets,
  media,
  object,
  relation,
  relinkReferences,
  repeater,
  resolveMarkdocTarget,
  richText,
  slug,
  text,
} from "../src/internal.js";

const fields = {
  title: text(),
  author: relation({ collection: "team" }),
  reviewers: relation({ collection: "team", multiple: true }),
  cover: media({ alt: "optional" }),
  seo: object({ fields: { image: media() } }),
  sections: repeater({ fields: { contact: relation({ collection: "team" }), photos: media({ multiple: true }) } }),
};

describe("documentLinks", () => {
  it("finds relations and media at every level, with the field's path", () => {
    const found = documentLinks(fields, {
      title: "Hello",
      author: "anna",
      reviewers: ["bob", ""],
      cover: { path: "news/hello/media/a.jpg", alt: null },
      seo: { image: "media/og.png" },
      sections: [{ contact: "carla", photos: ["news/hello/media/b.jpg"] }, { contact: null, photos: [] }],
    }, "news/hello");

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
    assert.deepEqual(documentLinks(fields, {}, "news/hello"), []);
  });
});

describe("walkFields and mapFields", () => {
  const model = {
    title: text(),
    seo: object({ fields: { image: media() } }),
    sections: repeater({ fields: { photos: media({ multiple: true }) } }),
  };

  it("visit every field with its value and its path, a container before its fields", () => {
    const seen: string[] = [];
    walkFields(model, { title: "A", seo: { image: "a.jpg" }, sections: [{ photos: [] }, "not a row"] }, (field, value, path) => {
      seen.push(`${path.join(".")}=${field.kind}`);
    });
    assert.deepEqual(seen, ["title=text", "seo=object", "seo.image=media", "sections=repeater", "sections.0.photos=media"]);
  });

  it("map every value that is not a container, and leave an absent key absent", () => {
    const data = { seo: { image: "a.jpg" }, sections: [{ photos: ["b.jpg"] }], extra: 1 };
    const mapped = mapFields(model, data, (field, value) => {
      const mark = (one: unknown) => `${String(one)}!`;
      if (field.kind !== "media" || value === undefined) return value;
      return Array.isArray(value) ? value.map(mark) : mark(value);
    });
    assert.deepEqual(mapped, { seo: { image: "a.jpg!" }, sections: [{ photos: ["b.jpg!"] }], extra: 1 });
    assert.equal("title" in mapped, false);
  });
});

describe("ownerOfPath", () => {
  const site = defineSite({
    collections: { projects: collection({ label: "Projects", fields: { slug: slug() } }) },
    singletons: { site: { type: "singleton", name: "", label: "Website", fields: { title: text() } } },
  });

  it("names the entry, singleton, order or shared media of a file", () => {
    const entry = { kind: "entry", collection: "projects", slug: "haus-a", label: "haus-a" };
    assert.deepEqual(ownerOfPath(site, "projects/haus-a/index.json"), entry);
    assert.deepEqual(ownerOfPath(site, "projects/haus-a/media/a.jpg"), entry);
    assert.deepEqual(ownerOfPath(site, "site/index.json"), { kind: "singleton", name: "site", label: "Website" });
    assert.deepEqual(ownerOfPath(site, "projects/_order.json"), { kind: "order", collection: "projects", label: "Projects: order" });
    assert.deepEqual(ownerOfPath(site, "media/logo.png"), { kind: "media", label: "Shared media" });
    assert.equal(ownerOfPath(site, "projects/notes.txt").kind, "other");
    assert.equal(ownerOfPath(site, "constructor/x/index.json").kind, "other");
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
    const data = { body: "![A](media/a.jpg) [Site](https://example.com)", sections: [{ text: "[Prices](/media/prices.pdf) ![Out](../../../x.jpg)" }] };
    assert.deepEqual(documentLinks(model, data, "news/hello"), [
      { kind: "image", field: "body", target: "media/a.jpg", path: "news/hello/media/a.jpg" },
      { kind: "image", field: "sections.0.text", target: "../../../x.jpg", path: null },
      { kind: "link", field: "sections.0.text", target: "/media/prices.pdf", path: "media/prices.pdf" },
    ]);
    assert.deepEqual(markdocTargets(data.sections[0]!.text), ["/media/prices.pdf", "../../../x.jpg"]);
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

describe("images in rich text, by the shared rule", () => {
  it("leaves out code, and reads a path in angle brackets", () => {
    const text = "![A](media/a.jpg)\n\n```md\n![B](media/b.jpg)\n```\n\nSee `![C](media/c.jpg)` and ![D](<media/d e.jpg>)";
    assert.deepEqual(markdocImages(text), ["media/a.jpg", "media/d e.jpg"]);
  });

  it("treats a protocol-relative address as one on the web", () => {
    assert.equal(isWebAddress("//cdn.example.com/a.png"), true);
    assert.equal(resolveMarkdocTarget("//cdn.example.com/a.png", "news/x"), null);
  });

  it("finds the images that exist, and reports a missing relative one but not a missing /path", async () => {
    const site = defineSite({ collections: { news: collection({ label: "News", fields: { slug: slug(), body: richText() } }) } });
    const source = memorySource({ "news/x/index.json": "{}", "news/x/media/a.jpg": "jpg", "media/logo.png": "png" });
    const body = "![A](media/a.jpg) ![L](/media/logo.png) ![P](/photo.jpg) ![G](media/gone.jpg) ![U](../../../up.jpg) ![W](https://example.com/w.png)";
    const check = createReferenceCheck(site, source);
    const { found, issues } = await check.richTextImages(site.collections.news!.fields, { body }, "news/x");
    assert.deepEqual(found, [{ target: "media/a.jpg", path: "news/x/media/a.jpg" }, { target: "/media/logo.png", path: "media/logo.png" }]);
    assert.deepEqual(issues.map((issue) => issue.message), [
      'The image "media/gone.jpg" does not exist.',
      'The image "../../../up.jpg" is outside the content root.',
    ]);
    assert.equal((await check.issues(site.collections.news!.fields, { body }, "news/x")).length, 2);
    assert.equal((await check.issues(site.collections.news!.fields, { body })).length, 0);
  });
});

describe("reference sets (#280)", () => {
  const places = referenceSet({ label: "Places", file: "src/data/places.csv", id: "slug", title: "name" });
  const site = defineSite({
    collections: { tours: collection({ label: "Tours", fields: { title: text(), slug: slug(), summit: relation({ collection: "places" }) } }) },
    references: { places },
  });

  it("are a target for relations, with a name of their own", () => {
    assert.equal(site.references?.["places"]?.name, "places");
    assert.throws(
      () => defineSite({ collections: { places: collection({ label: "P", fields: { slug: slug() } }) }, references: { places } }),
      (error: unknown) => error instanceof ModelError && /unique across all three/.test(error.message),
    );
    assert.throws(() => defineSite({ collections: {}, references: { places: referenceSet({ label: "Places", file: "" }) } }), ModelError);
  });

  it("travel in the manifest, and come back the same", () => {
    const read = readManifest(JSON.parse(JSON.stringify(createManifest(site, "test"))));
    assert.deepEqual(read.site.references, site.references);
    assert.equal(read.readOnly.size, 0);
  });

  it("write their index one item to a line, and read it back", () => {
    const items = [{ id: "piz-palue", title: "Piz Palü" }, { id: "toedi", title: "Tödi" }];
    const text = serializeReferenceIndex(items);
    assert.equal(text.split("\n").length, 5);
    assert.deepEqual(parseReferenceIndex(text), items);
    assert.throws(() => parseReferenceIndex('[{ "id": 1 }]'));
  });

  it("check a relation against the index, and name a missing index", async () => {
    const withIndex = memorySource({ [referenceIndexPath("places")]: serializeReferenceIndex([{ id: "toedi", title: "Tödi" }]) });
    const check = createReferenceCheck(site, withIndex);
    const fields = site.collections["tours"]!.fields;
    assert.deepEqual(await check.issues(fields, { summit: "toedi" }), []);
    assert.match((await check.issues(fields, { summit: "eiger" }))[0]!.message, /"eiger" in Places, which does not exist/);

    const without = createReferenceCheck(site, memorySource({}));
    assert.match((await without.issues(fields, { summit: "toedi" }))[0]!.message, /has no index in \.mica\/references\/places\.json/);
  });
});

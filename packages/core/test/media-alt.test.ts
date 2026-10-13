/** `media({ alt })`: the field stores `{ path, alt }`, and a plain `media()` keeps storing a path. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collection,
  defineSite,
  media,
  memorySource,
  readCollection,
  relativizeMedia,
  serializeEntry,
  slug,
  text,
  validateFields,
  type InferFields,
  type MediaWithAlt,
} from "../dist/index.js";

const fields = {
  title: text(),
  slug: slug({ from: "title" }),
  cover: media({ alt: "required" }),
  gallery: media({ alt: "optional", multiple: true }),
  file: media(),
};

/* Type-level assertions: these fail at `rush typecheck`, not at runtime. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Inferred = InferFields<typeof fields>;
/* eslint-disable @typescript-eslint/no-unused-vars */
type _Required = Expect<Equal<Inferred["cover"], { path: string; alt: string } | null>>;
type _Optional = Expect<Equal<Inferred["gallery"], MediaWithAlt[]>>;
type _Plain = Expect<Equal<Inferred["file"], string | null>>;
/* eslint-enable @typescript-eslint/no-unused-vars */

describe("media with alt text", () => {
  it("accepts a path with alt text, and refuses a required one without it", () => {
    assert.equal(validateFields(fields, { cover: { path: "media/a.jpg", alt: "A house" } }).ok, true);

    const missing = validateFields(fields, { cover: { path: "media/a.jpg", alt: "  " } });
    assert.equal(missing.ok, false);
    assert.deepEqual(!missing.ok && missing.issues, [{ path: "cover.alt", message: "cover needs alt text." }]);
  });

  it("lets a draft leave the alt text empty", () => {
    const draft = validateFields(fields, { cover: { path: "media/a.jpg" } }, { enforceRequired: false });
    assert.deepEqual(draft.ok && draft.data["cover"], { path: "media/a.jpg", alt: null });
  });

  it("reads a path saved before the field asked for alt text", () => {
    const result = validateFields(fields, { gallery: ["media/a.jpg"] });
    assert.deepEqual(result.ok && result.data["gallery"], [{ path: "media/a.jpg", alt: null }]);
  });

  it("reads a stored { path, alt } as its path after the option is removed", () => {
    const result = validateFields({ file: media() }, { file: { path: "media/a.pdf", alt: "Plan" } });
    assert.equal(result.ok && result.data["file"], "media/a.pdf");
  });

  it("writes the path and the alt text in a fixed order", () => {
    const { data } = serializeEntry(fields, {
      cover: { alt: "A house", path: "media/a.jpg" },
      gallery: [{ alt: null, path: "media/b.jpg" }],
    });
    assert.match(data, /"cover": \{\n {4}"path": "media\/a\.jpg",\n {4}"alt": "A house"\n {2}\}/);
    assert.match(data, /"gallery": \[\n {4}\{\n {6}"path": "media\/b\.jpg",\n {6}"alt": null/);
  });

  it("resolves only the path against the entry, and turns it back on save", async () => {
    const site = defineSite({ collections: { projects: collection({ label: "Projects", fields }) } });
    const source = memorySource({
      "projects/haus/index.json": JSON.stringify({
        title: "Haus",
        slug: "haus",
        cover: { path: "media/a.jpg", alt: "A house" },
        gallery: [{ path: "/shared/b.jpg", alt: null }],
        file: "media/plan.pdf",
      }),
    });

    const [entry] = await readCollection(source, site.collections["projects"]!, "projects");
    assert.deepEqual(entry!.data["cover"], { path: "projects/haus/media/a.jpg", alt: "A house" });
    assert.deepEqual(entry!.data["gallery"], [{ path: "shared/b.jpg", alt: null }]);
    assert.equal(entry!.data["file"], "projects/haus/media/plan.pdf");

    const back = relativizeMedia(fields, entry!.data, "projects/haus");
    assert.deepEqual(back["cover"], { path: "media/a.jpg", alt: "A house" });
    assert.deepEqual(back["gallery"], [{ path: "/shared/b.jpg", alt: null }]);
  });
});

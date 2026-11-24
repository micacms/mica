/** A media value is one object: `{ path, alt }` for a file in the content repository, `{ provider, id, … }` for a file at a provider. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  collection,
  defineSite,
  documentLinks,
  media,
  memorySource,
  readCollection,
  relativizeMedia,
  serializeEntry,
  id,
  text,
  validateFields,
  type InferFields,
  type MediaFileValue,
} from "../src/internal.js";

const fields = {
  title: text(),
  id: id({ from: "title" }),
  cover: media({ alt: "required" }),
  gallery: media({ alt: "optional", multiple: true }),
  file: media(),
};

/* Type-level assertions: these fail at `rush typecheck`, not at runtime. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Inferred = InferFields<typeof fields>;
/* eslint-disable @typescript-eslint/no-unused-vars */
type _Required = Expect<Equal<Inferred["cover"], (MediaFileValue & { alt: string }) | null>>;
type _Optional = Expect<Equal<Inferred["gallery"], MediaFileValue[]>>;
type _Plain = Expect<Equal<Inferred["file"], MediaFileValue | null>>;
/* eslint-enable @typescript-eslint/no-unused-vars */

const external = {
  provider: "acme-dam",
  id: "a1b2",
  alt: "The harbour",
  url: "https://cdn.example/a1b2.jpg",
  type: "image/jpeg",
  width: 2400,
  height: 1600,
};

describe("a media value", () => {
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

  it("is an object also in a field that asks for no alt text", () => {
    const result = validateFields(fields, { file: { path: "media/a.pdf" } });
    assert.deepEqual(result.ok && result.data["file"], { path: "media/a.pdf", alt: null });
  });

  it("refuses a plain path, with the shape in the message", () => {
    const result = validateFields(fields, { file: "media/a.pdf", gallery: ["media/a.jpg"] }, { enforceRequired: false });
    assert.deepEqual(!result.ok && result.issues, [
      { path: "gallery.0", message: 'gallery must be a file: { "path": "…" }.' },
      { path: "file", message: 'file must be a file: { "path": "…" }.' },
    ]);
  });

  it("refuses a path that leaves the content root", () => {
    const result = validateFields(fields, { file: { path: "../secret.pdf" } }, { enforceRequired: false });
    assert.deepEqual(!result.ok && result.issues, [{ path: "file.path", message: "file must be a file inside the content root." }]);
  });

  it("keeps the properties, and drops a key that is not part of the value", () => {
    const result = validateFields(fields, { file: { path: "media/a.pdf", properties: { pages: 4 }, other: 1 } }, { enforceRequired: false });
    assert.deepEqual(result.ok && result.data["file"], { path: "media/a.pdf", alt: null, properties: { pages: 4 } });
  });

  it("refuses a file at a provider that Mica does not know, and names what it lacks", () => {
    const unknown = { path: "cover.provider", message: 'cover: Mica does not know the media provider "acme-dam".' };
    const result = validateFields(fields, { cover: external });
    assert.deepEqual(!result.ok && result.issues, [unknown]);

    const address = { path: "cover.url", message: "cover needs a web address that starts with http:// or https://." };
    const { url: _url, ...withoutAddress } = external;
    const missing = validateFields(fields, { cover: withoutAddress });
    assert.deepEqual(!missing.ok && missing.issues, [unknown, address]);

    const script = validateFields(fields, { cover: { ...external, url: "javascript:alert(1)" } });
    assert.deepEqual(!script.ok && script.issues, [unknown, address]);
  });

  it("writes the keys in a fixed order, and the alt text only where it is asked for or present", () => {
    const { data } = serializeEntry(fields, {
      cover: { alt: "A house", path: "media/a.jpg" },
      gallery: [{ properties: { credit: "Ada" }, alt: null, path: "media/b.jpg" }],
      file: { alt: null, properties: {}, path: "media/plan.pdf" },
    });
    const stored = JSON.parse(data) as Record<string, unknown>;
    assert.equal(JSON.stringify(stored["cover"]), '{"path":"media/a.jpg","alt":"A house"}');
    assert.equal(JSON.stringify(stored["gallery"]), '[{"path":"media/b.jpg","alt":null,"properties":{"credit":"Ada"}}]');
    assert.equal(JSON.stringify(stored["file"]), '{"path":"media/plan.pdf"}');
  });

  it("writes a file at a provider in a fixed order", () => {
    const { data } = serializeEntry(fields, { cover: { height: 1600, width: 2400, type: "image/jpeg", url: external.url, alt: null, id: "a1b2", provider: "acme-dam" } });
    assert.equal(
      JSON.stringify((JSON.parse(data) as Record<string, unknown>)["cover"]),
      '{"provider":"acme-dam","id":"a1b2","alt":null,"url":"https://cdn.example/a1b2.jpg","type":"image/jpeg","width":2400,"height":1600}',
    );
  });

  it("resolves only the path against the entry, and turns it back on save", async () => {
    const site = defineSite({ collections: { projects: collection({ label: "Projects", fields }) } });
    const source = memorySource({
      "projects/haus/index.json": JSON.stringify({
        title: "Haus",
        id: "haus",
        cover: { path: "media/a.jpg", alt: "A house" },
        gallery: [{ path: "/shared/b.jpg", alt: null }, external],
        file: { path: "media/plan.pdf" },
      }),
    });

    const [entry] = await readCollection(source, site.collections["projects"]!, "projects");
    assert.deepEqual(entry!.data["cover"], { path: "projects/haus/media/a.jpg", alt: "A house" });
    assert.deepEqual(entry!.data["gallery"], [{ path: "shared/b.jpg", alt: null }, external]);
    assert.deepEqual(entry!.data["file"], { path: "projects/haus/media/plan.pdf" });

    const back = relativizeMedia(fields, entry!.data, "projects/haus");
    assert.deepEqual(back["cover"], { path: "media/a.jpg", alt: "A house" });
    assert.deepEqual(back["gallery"], [{ path: "/shared/b.jpg", alt: null }, external]);
  });

  it("counts a file in the content repository as a link, and a file at a provider as none", () => {
    const links = documentLinks(fields, { cover: external, gallery: [{ path: "shared/b.jpg", alt: null }], file: { path: "x/plan.pdf" } }, "x");
    assert.deepEqual(links, [
      { kind: "media", field: "gallery.0", path: "shared/b.jpg" },
      { kind: "media", field: "file", path: "x/plan.pdf" },
    ]);
  });
});

describe("an image that the site framework resolves", () => {
  // Stands in for Astro's `image()`.
  const image = () => z.string().transform((path) => ({ resolved: path }));
  const images = { cover: media({ accept: "image", alt: "required" }), logo: media({ accept: "image" }), file: media() };

  it("gives { src, alt } for an image, with \"\" for no alt text; other media stay stored values", () => {
    const result = validateFields(images, { cover: { path: "./media/a.jpg", alt: "A house" }, logo: { path: "./logo.png" }, file: { path: "media/a.pdf" } }, { image });
    assert.ok(result.ok);
    assert.deepEqual(result.data["cover"], { src: { resolved: "./media/a.jpg" }, alt: "A house" });
    assert.deepEqual(result.data["logo"], { src: { resolved: "./logo.png" }, alt: "" });
    assert.deepEqual(result.data["file"], { path: "media/a.pdf", alt: null });
  });

  it("still refuses a required image without alt text", () => {
    assert.equal(validateFields(images, { cover: { path: "./media/a.jpg", alt: "" } }, { image }).ok, false);
  });
});

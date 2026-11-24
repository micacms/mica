/** Image fields reach Astro's `image()` as paths from the entry's file. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { media, object, text } from "@micacms/core/internal";

import { imagePathsFromEntry } from "../src/images.js";

const fields = {
  title: text(),
  cover: media({ accept: "image", alt: "required" }),
  gallery: media({ accept: "image", multiple: true }),
  file: media(),
  seo: object({ fields: { image: media({ accept: "image" }) } }),
};

describe("imagePathsFromEntry", () => {
  it("rewrites image paths from the content root to the entry's file, and leaves other media alone", () => {
    const data = imagePathsFromEntry(
      fields,
      {
        title: "Haus",
        cover: { path: "projects/haus/media/a.jpg", alt: "A house" },
        gallery: [{ path: "projects/haus/media/b.jpg" }, { path: "shared/c.jpg" }],
        file: { path: "projects/haus/media/plan.pdf" },
        seo: { image: { path: "projects/haus/media/og.png" } },
      },
      "projects/haus/index.json",
    );

    assert.deepEqual(data["cover"], { path: "./media/a.jpg", alt: "A house" });
    assert.deepEqual(data["gallery"], [{ path: "./media/b.jpg" }, { path: "../../shared/c.jpg" }]);
    assert.deepEqual(data["file"], { path: "projects/haus/media/plan.pdf" });
    assert.deepEqual(data["seo"], { image: { path: "./media/og.png" } });
  });

  it("leaves empty values as they are", () => {
    const data = imagePathsFromEntry(fields, { cover: null, gallery: [] }, "projects/haus/index.json");
    assert.equal(data["cover"], null);
    assert.deepEqual(data["gallery"], []);
  });
});

describe("an image path out of the content root (#213, N15)", () => {
  it("never reaches Astro's image()", () => {
    const fields = { cover: media({ accept: "image" }) };
    assert.throws(() => imagePathsFromEntry(fields, { cover: { path: "../../etc/x.png" } }, "news/a/index.json"), /relative segment/);
  });
});

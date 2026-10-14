/** Image fields reach Astro's `image()` as paths from the entry's file. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { media, object, text } from "@micacms/core/internal";

import { imagePathsFromEntry } from "../dist/images.js";

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
        gallery: ["projects/haus/media/b.jpg", "shared/c.jpg"],
        file: "projects/haus/media/plan.pdf",
        seo: { image: "projects/haus/media/og.png" },
      },
      "projects/haus/index.json",
    );

    assert.deepEqual(data["cover"], { path: "./media/a.jpg", alt: "A house" });
    assert.deepEqual(data["gallery"], ["./media/b.jpg", "../../shared/c.jpg"]);
    assert.equal(data["file"], "projects/haus/media/plan.pdf");
    assert.deepEqual(data["seo"], { image: "./media/og.png" });
  });

  it("leaves empty values as they are", () => {
    const data = imagePathsFromEntry(fields, { cover: null, gallery: [] }, "projects/haus/index.json");
    assert.equal(data["cover"], null);
    assert.deepEqual(data["gallery"], []);
  });
});

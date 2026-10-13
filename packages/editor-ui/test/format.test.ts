/** List cells and dates in the editor's terms (#104). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coordinates, date, media, richText, select } from "@micacms/core";

import { coordinatesFrom, localDate, markdocText, previewValue } from "../src/lib/format.js";

describe("previewValue", () => {
  it("shows a choice by its label, rich text as words, and a file by its name", () => {
    const size = select({ options: [{ value: "s", label: "Small" }, { value: "l", label: "Large" }] });
    assert.equal(previewValue("l", size), "Large");
    assert.equal(previewValue(["s", "l"], select({ multiple: true, options: size.options })), "Small, Large");
    assert.equal(previewValue("## Hello\n\nSee **the** [map](https://example.com).", richText()), "Hello See the map.");
    assert.equal(previewValue("projects/a/media/front.jpg", media()), "front.jpg");
    assert.equal(previewValue({ path: "media/x.png", alt: "X" }, media({ alt: "optional" })), "x.png");
    assert.equal(previewValue({ lat: 47.37691, lng: 8.54169 }, coordinates()), "47.3769, 8.5417");
  });

  it("shows a calendar date as a date, not as a stored string", () => {
    const shown = previewValue("2026-10-13", date());
    assert.notEqual(shown, "2026-10-13");
    assert.match(shown, /2026/);
  });

  it("shows nothing as a dash", () => {
    assert.equal(previewValue(null), "—");
    assert.equal(previewValue([], media({ multiple: true })), "—");
  });
});

describe("markdocText", () => {
  it("leaves out tags and marks", () => {
    assert.equal(markdocText('{% callout %}\n- *One* `two`\n{% /callout %}'), "One two");
  });
});

describe("localDate", () => {
  it("uses the local calendar date", () => {
    const lateEvening = new Date(2026, 9, 13, 23, 30);
    assert.equal(localDate(lateEvening), "2026-10-13");
  });
});

describe("coordinatesFrom", () => {
  it("keeps a missing half empty instead of making it 0", () => {
    assert.deepEqual(coordinatesFrom("47.37", ""), { lat: 47.37, lng: null });
    assert.equal(coordinatesFrom("47.37", "x"), undefined);
    assert.deepEqual(coordinatesFrom("47.37", "8.54"), { lat: 47.37, lng: 8.54 });
    assert.equal(coordinatesFrom(" ", ""), null);
  });
});

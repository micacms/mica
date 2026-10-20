/** The live preview's field markers: what the loader adds, and what the page reads back. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { object, repeater, richText, slug, text, textarea } from "@micacms/core/internal";

import { markTextFields, previewMarkersEnabled } from "../src/preview/mark.js";
import { decodeMarkers, encodeMarker, markerKey, markerOfKey, splitMarkers } from "../src/preview/markers.js";
import { renderRichText, validateRichText } from "../src/richtext.js";

describe("field markers", () => {
  it("reads back what it wrote, also in another script", () => {
    const marker = { document: "news", id: "grüezi-zürich", path: "facts.2.label" };
    assert.deepEqual(decodeMarkers(`Grüezi ${encodeMarker(marker)}`), [marker]);
  });

  it("adds nothing that people see", () => {
    const visible = encodeMarker({ document: "news", id: "a", path: "title" }).replace(/[\u2064\ufe00-\ufe0f]/gu, "");
    assert.equal(visible, "");
  });

  it("is short: two characters for each byte", () => {
    assert.equal(encodeMarker({ document: "pages", id: "legal", path: "title" }).length, 1 + 2 * "pages.legal.title.".length);
  });

  it("leaves out a marker that a template cut short", () => {
    const marker = encodeMarker({ document: "news", id: "a", path: "title" });
    assert.deepEqual(decodeMarkers(`Title${marker.slice(0, -3)}`), []);
    assert.deepEqual(decodeMarkers(`Title${marker.slice(0, -2)}`), []);
    assert.deepEqual(decodeMarkers("Plain text"), []);
  });

  it("marks text and textarea values, also in objects and rows, and nothing else", () => {
    const fields = {
      title: text(),
      slug: slug(),
      summary: textarea(),
      seo: object({ fields: { title: text() } }),
      facts: repeater({ fields: { label: text() } }),
    };
    const data = { title: "Haus A", slug: "haus-a", summary: "", seo: { title: "SEO" }, facts: [{ label: "One" }, { label: "Two" }] };
    const marked = markTextFields(fields, data, "projects", "haus-a") as typeof data;

    assert.equal(marked.slug, "haus-a");
    assert.equal(marked.summary, "");
    assert.deepEqual(decodeMarkers(marked.title), [{ document: "projects", id: "haus-a", path: "title" }]);
    assert.deepEqual(decodeMarkers(marked.seo.title), [{ document: "projects", id: "haus-a", path: "seo.title" }]);
    assert.deepEqual(decodeMarkers(marked.facts[1]!.label), [{ document: "projects", id: "haus-a", path: "facts.1.label" }]);
  });

  it("leaves out values that a template can use as a link, also a phone number", () => {
    const fields = { a: text(), b: text(), c: text(), d: text(), e: text(), f: text() };
    const data = { a: "/about-us", b: "#team", c: "tel:+41445550100", d: "https://example.com/x", e: "Ask: 10 / 12", f: "+990 40 555 0143" };
    const marked = markTextFields(fields, data, "site", "site");
    assert.deepEqual({ ...marked, e: data.e }, data);
    assert.equal(decodeMarkers(marked["e"] as string).length, 1);
  });

  it("splits a text from its markers, and reads a key back", () => {
    const marker = { document: "news", id: "a", path: "body" };
    assert.deepEqual(splitMarkers(`# Hi${encodeMarker(marker)}`), { text: "# Hi", markers: [marker] });
    assert.deepEqual(markerOfKey(markerKey(marker)), marker);
    assert.equal(markerOfKey("not json"), null);
  });

  it("marks a rich text, and renderRichText marks each block instead, with its place", async () => {
    const marked = markTextFields({ body: richText() }, { body: "# Hi\n\nOne\n\n- a\n- b" }, "news", "a") as { body: string };
    const html = await renderRichText(marked.body);
    const key = markerKey({ document: "news", id: "a", path: "body" }).replaceAll('"', "&quot;");
    assert.match(html, new RegExp(`<h1 data-mica-field="${key.replaceAll("[", "\\[").replaceAll("]", "\\]")}" data-mica-block="0">Hi</h1>`));
    assert.match(html, /<p [^>]*data-mica-block="1">One<\/p>/);
    assert.match(html, /<ul [^>]*data-mica-block="2">/);
    assert.doesNotMatch(html, /[\u2064\ufe00-\ufe0f]/u);
    assert.deepEqual(validateRichText(marked.body), []);
  });

  it("is on only in dev with MICA_PREVIEW", () => {
    const before = process.env["MICA_PREVIEW"];
    try {
      process.env["MICA_PREVIEW"] = "1";
      assert.equal(previewMarkersEnabled(true), true);
      assert.equal(previewMarkersEnabled(false), false);
      delete process.env["MICA_PREVIEW"];
      assert.equal(previewMarkersEnabled(true), false);
    } finally {
      if (before === undefined) delete process.env["MICA_PREVIEW"];
      else process.env["MICA_PREVIEW"] = before;
    }
  });
});

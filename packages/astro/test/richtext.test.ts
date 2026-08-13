/**
 * Rich-text rendering.
 *
 * The behaviour worth pinning down is not that headings become `<h2>` — Markdoc
 * does that — but that the closed set holds: a document cannot render markup
 * the site did not agree to.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderRichText, validateRichText } from "../dist/index.js";

describe("renderRichText", () => {
  it("renders the constructs the field DSL offers", () => {
    const html = renderRichText(
      ["# Title", "", "Some **bold** and _italic_ text.", "", "- one", "- two"].join("\n"),
    );

    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<li>one<\/li>/);
  });

  it("renders links with their target", () => {
    const html = renderRichText("[Contact](https://example.com)");
    assert.match(html, /<a href="https:\/\/example\.com">Contact<\/a>/);
  });

  it("returns an empty string for an empty field", () => {
    assert.equal(renderRichText(null), "");
    assert.equal(renderRichText(""), "");
    assert.equal(renderRichText("   \n  "), "");
  });

  it("escapes raw HTML rather than emitting it", () => {
    const html = renderRichText('Before <script>alert("x")</script> after');

    // The point of Markdoc as the canonical format: content committed to Git
    // cannot introduce script into a build, however it got there. The text
    // survives — escaped, and therefore inert — because silently deleting a
    // sentence would be its own kind of wrong.
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /after/);
  });

  it("renders nothing for a tag the project has not declared", () => {
    const html = renderRichText("{% gallery id=1 %}");

    assert.equal(html.includes("gallery"), false);
    assert.ok(validateRichText("{% gallery id=1 %}").length > 0, "and says so when asked");
  });

  it("renders a tag the project does declare", () => {
    const html = renderRichText("{% callout %}Careful.{% /callout %}", {
      config: {
        tags: {
          callout: { render: "aside", attributes: {} },
        },
      },
    });

    assert.match(html, /<aside>.*Careful\..*<\/aside>/s);
  });
});

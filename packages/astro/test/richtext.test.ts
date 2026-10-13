/**
 * Rich-text rendering.
 *
 * The behaviour worth pinning down is not that headings become `<h2>` — Markdoc
 * does that — but that the closed set holds: a document cannot render markup
 * the site did not agree to.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Markdoc from "@markdoc/markdoc";

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

describe("a custom tag, as the recipes page shows it", () => {
  // The configuration on micacms.com/docs/recipes/; change both together.
  const config = {
    tags: {
      callout: {
        render: "aside",
        attributes: { type: { type: String, default: "note", matches: ["note", "warning"] } },
        transform(node: Markdoc.Node, config: Markdoc.Config) {
          const attributes = node.transformAttributes(config);
          return new Markdoc.Tag("aside", { class: `callout callout-${attributes.type}` }, node.transformChildren(config));
        },
      },
    },
  };

  it("renders the tag that the configuration declares, and nothing for another", () => {
    const source = '{% callout type="warning" %}\nBook a time **before** you visit.\n{% /callout %}\n\n{% gallery /%}';
    assert.equal(
      renderRichText(source, { config }),
      '<article><aside class="callout callout-warning"><p>Book a time <strong>before</strong> you visit.</p></aside></article>',
    );
  });
});

describe("images in rich text", () => {
  it("finds an image whose path has a space or a letter outside ASCII", () => {
    const images = [
      { path: "media/team photo.jpg", src: { src: "/_astro/a.jpg" } },
      { path: "media/zürich.jpg", src: { src: "/_astro/b.jpg" } },
    ];
    const html = renderRichText("![A](<media/team photo.jpg>)\n\n![B](media/zürich.jpg)", { images });
    assert.match(html, /src="\/_astro\/a\.jpg"/);
    assert.match(html, /src="\/_astro\/b\.jpg"/);
  });

  it("uses the address, width and height that Astro made, and leaves other images as they are", () => {
    const images = [{ path: "media/plan.png", src: { src: "/_astro/plan.hash.png", width: 800, height: 600 } }];
    const html = renderRichText("![A plan](media/plan.png)\n\n![Web](https://example.com/a.png)", { images });
    assert.equal(
      html,
      '<article><p><img src="/_astro/plan.hash.png" alt="A plan" width="800" height="600" loading="lazy" decoding="async"></p><p><img src="https://example.com/a.png" alt="Web"></p></article>',
    );
  });
});

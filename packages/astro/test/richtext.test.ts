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

import { renderRichText, validateRichText, type GetImage } from "../src/index.js";

describe("renderRichText", () => {
  it("renders the constructs the field DSL offers", async () => {
    const html = await renderRichText(
      ["# Title", "", "Some **bold** and _italic_ text.", "", "- one", "- two"].join("\n"),
    );

    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<li>one<\/li>/);
  });

  it("renders links with their target", async () => {
    const html = await renderRichText("[Contact](https://example.com)");
    assert.match(html, /<a href="https:\/\/example\.com">Contact<\/a>/);
  });

  it("returns an empty string for an empty field", async () => {
    assert.equal(await renderRichText(null), "");
    assert.equal(await renderRichText(""), "");
    assert.equal(await renderRichText("   \n  "), "");
  });

  it("escapes raw HTML rather than emitting it", async () => {
    const html = await renderRichText('Before <script>alert("x")</script> after');

    // The point of Markdoc as the canonical format: content committed to Git
    // cannot introduce script into a build, however it got there. The text
    // survives — escaped, and therefore inert — because silently deleting a
    // sentence would be its own kind of wrong.
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /after/);
  });

  it("renders nothing for a tag the project has not declared", async () => {
    const html = await renderRichText("{% gallery id=1 %}");

    assert.equal(html.includes("gallery"), false);
    assert.ok(validateRichText("{% gallery id=1 %}").length > 0, "and says so when asked");
  });

  it("renders a tag the project does declare", async () => {
    const html = await renderRichText("{% callout %}Careful.{% /callout %}", null, {
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

  it("renders the tag that the configuration declares, and nothing for another", async () => {
    const source = '{% callout type="warning" %}\nBook a time **before** you visit.\n{% /callout %}\n\n{% gallery /%}';
    assert.equal(
      await renderRichText(source, null, { config }),
      '<article><aside class="callout callout-warning"><p>Book a time <strong>before</strong> you visit.</p></aside></article>',
    );
  });
});

describe("images in rich text", () => {
  const entry = (images: Array<{ path: string; src: { src: string; width?: number; height?: number } }>) => ({ _mica: { images } });

  it("finds an image whose path has a space or a letter outside ASCII", async () => {
    const data = entry([
      { path: "media/team photo.jpg", src: { src: "/_astro/a.jpg" } },
      { path: "media/zürich.jpg", src: { src: "/_astro/b.jpg" } },
    ]);
    const html = await renderRichText("![A](<media/team photo.jpg>)\n\n![B](media/zürich.jpg)", data);
    assert.match(html, /src="\/_astro\/a\.jpg"/);
    assert.match(html, /src="\/_astro\/b\.jpg"/);
  });

  it("writes the original's address, width and height without optimizing, and leaves other images as they are", async () => {
    const data = entry([{ path: "media/plan.png", src: { src: "/_astro/plan.hash.png", width: 800, height: 600 } }]);
    const html = await renderRichText("![A plan](media/plan.png)\n\n![Web](https://example.com/a.png)", data, { optimize: false });
    assert.equal(
      html,
      '<article><p><img src="/_astro/plan.hash.png" alt="A plan" width="800" height="600" loading="lazy" decoding="async"></p><p><img src="https://example.com/a.png" alt="Web"></p></article>',
    );
  });

  it("asks Astro for the sizes that fit, and writes its srcset", async () => {
    const asked: unknown[] = [];
    const getImage: GetImage = async (options) => {
      asked.push(options);
      return { src: "/_astro/plan.1200.webp", srcSet: { attribute: "/_astro/plan.480.webp 480w, /_astro/plan.1200.webp 1200w" }, attributes: { width: 1200, height: 900 } };
    };
    const data = entry([{ path: "media/plan.png", src: { src: "/_astro/plan.png", width: 1300, height: 975 } }]);
    const html = await renderRichText("![A plan](media/plan.png)\n\n![Again](media/plan.png)", data, { getImage });

    assert.equal(asked.length, 1, "one call for an image that the text shows twice");
    assert.deepEqual((asked[0] as { widths: number[] }).widths, [480, 800, 1200]);
    assert.match(html, /<img src="\/_astro\/plan\.1200\.webp" alt="A plan" srcset="\/_astro\/plan\.480\.webp 480w, \/_astro\/plan\.1200\.webp 1200w" sizes="\(min-width: 50rem\) 50rem, 100vw" width="1200" height="900" loading="lazy" decoding="async">/);
  });

  it("keeps the original outside an Astro build", async () => {
    const data = entry([{ path: "media/plan.png", src: { src: "/_astro/plan.png", width: 800, height: 600 } }]);
    assert.match(await renderRichText("![A plan](media/plan.png)", data), /src="\/_astro\/plan\.png"/);
  });
});

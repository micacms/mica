/**
 * Read-only is decided as a rich-text field loads, and an edit never changes
 * the answer: the editor refuses an edit that gives a document that would
 * open read-only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toMarkdoc, type ProseMirrorNode } from "../src/lib/markdoc.js";
import { loadRichText, richTextSchema, unkeepableReason } from "../src/lib/rich-text-extensions.js";

const paragraph = (text: string): ProseMirrorNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const image: ProseMirrorNode = { type: "image", attrs: { src: "media/plan.png", alt: "The plan" } };
const item = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: "listItem", content });
const code = (text: string): ProseMirrorNode => ({ type: "codeBlock", content: [{ type: "text", text }] });
const table: ProseMirrorNode = {
  type: "table",
  content: [
    { type: "tableRow", content: [{ type: "tableHeader", content: [paragraph("Name")] }] },
    { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("Anna")] }] },
  ],
};
const doc = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: "doc", content });
const node = (json: ProseMirrorNode) => richTextSchema.nodeFromJSON(json);

describe("loadRichText", () => {
  it("gives the document of text that the editor can keep", () => {
    const load = loadRichText("## Title\n\nSome **bold** text.\n");
    assert.equal(load.readOnly, null);
    assert.equal(load.doc?.content?.[0]?.type, "heading");
  });

  it("gives an editable empty document for an empty field", () => {
    assert.deepEqual(loadRichText(null), { doc: { type: "doc", content: [{ type: "paragraph" }] }, readOnly: null });
  });

  it("names what the editor cannot show, and gives no document", () => {
    const load = loadRichText("{% callout %}\nHi\n{% /callout %}\n\n![A](a.png \"Title\")\n");
    assert.equal(load.doc, null);
    assert.equal(load.readOnly, "This text contains a {% callout %} tag and an image title, which the editor cannot show.");
  });
});

describe("unkeepableReason", () => {
  const refused = {
    "an image in a list": doc({ type: "bulletList", content: [item(paragraph("One"), image)] }),
    "an image in a quote in a numbered list": doc({ type: "orderedList", content: [item(paragraph("One"), { type: "blockquote", content: [image] })] }),
    "a tag in a code block": doc(code("{% callout %}")),
  };

  for (const [name, json] of Object.entries(refused)) {
    it(`refuses ${name}, which would open read-only`, () => {
      assert.ok(unkeepableReason(node(json)));
      assert.ok(loadRichText(toMarkdoc(json)).readOnly);
    });
  }

  it("says in plain words why an image cannot go in a list", () => {
    assert.equal(unkeepableReason(node(refused["an image in a list"])), "An image cannot go in a list. Put it above or below the list.");
  });

  const kept = {
    "an image after a list": doc({ type: "bulletList", content: [item(paragraph("One"))] }, image),
    "an image in a quote": doc({ type: "blockquote", content: [image] }),
    "a table in a list": doc({ type: "bulletList", content: [item(paragraph("One"), table)] }),
    "an open {% in a code block": doc(code("if (a {% b) {}")),
    "a tag in inline code": doc({ type: "paragraph", content: [{ type: "text", text: "{% callout %}", marks: [{ type: "code" }] }] }),
  };

  for (const [name, json] of Object.entries(kept)) {
    it(`allows ${name}, which loads again`, () => {
      assert.equal(unkeepableReason(node(json)), null);
      assert.equal(loadRichText(toMarkdoc(json)).readOnly, null);
    });
  }
});

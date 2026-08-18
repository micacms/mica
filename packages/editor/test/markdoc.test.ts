/**
 * The editor's Markdoc bridge.
 *
 * This conversion is the one place where an editor's words can quietly change
 * without anybody noticing: it runs on every keystroke and on every load, and a
 * mistake here corrupts the file rather than failing. So the tests are mostly
 * round trips — type it, store it, open it again, and get the same thing back.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fromMarkdoc, toMarkdoc, type ProseMirrorNode } from "../src/admin/lib/markdoc.js";

/** Markdoc in, Markdoc out, through the editor's representation. */
const roundTrip = (source: string): string => toMarkdoc(fromMarkdoc(source));

const text = (value: string, marks?: Array<{ type: string; attrs?: object }>) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

const doc = (...content: ProseMirrorNode[]): ProseMirrorNode => ({ type: "doc", content });

describe("toMarkdoc", () => {
  it("writes nothing for an empty document", () => {
    assert.equal(toMarkdoc(doc()), "");
    assert.equal(toMarkdoc(null), "");
  });

  it("never emits HTML", () => {
    const value = toMarkdoc(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Title")] },
        { type: "paragraph", content: [text("Bold", [{ type: "bold" }])] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("One")] }] }] },
      ),
    );

    assert.doesNotMatch(value, /<[a-z]/i);
    assert.equal(value, "## Title\n\n**Bold**\n\n- One\n");
  });

  it("nests a marked run from the inside out", () => {
    const value = toMarkdoc(
      doc({
        type: "paragraph",
        content: [
          text("here", [
            { type: "bold" },
            { type: "link", attrs: { href: "https://example.com" } },
          ]),
        ],
      }),
    );

    // The link wraps the emphasis, not the other way round — the reverse is
    // not valid Markdown.
    assert.equal(value, "[**here**](https://example.com)\n");
  });

  it("escapes text that would otherwise read as formatting", () => {
    const value = toMarkdoc(doc({ type: "paragraph", content: [text("2 * 3 * 4 and _this_")] }));

    assert.equal(value, "2 \\* 3 \\* 4 and \\_this\\_\n");
    // And it survives the trip back unchanged, which is the point of escaping.
    assert.equal(fromMarkdoc(value).content?.[0]?.content?.[0]?.text, "2 * 3 * 4 and _this_");
  });

  it("indents a list continuation under the text, not the marker", () => {
    const value = toMarkdoc(
      doc({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [text("Outer")] },
              {
                type: "bulletList",
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [text("Inner")] }] },
                ],
              },
            ],
          },
        ],
      }),
    );

    assert.equal(value, "- Outer\n\n  - Inner\n");
    // Read back, the nesting is still nesting rather than two flat items.
    const parsed = fromMarkdoc(value);
    assert.equal(parsed.content?.[0]?.content?.[0]?.content?.[1]?.type, "bulletList");
  });
});

describe("fromMarkdoc", () => {
  it("gives an editable document for empty input", () => {
    assert.deepEqual(fromMarkdoc(""), { type: "doc", content: [{ type: "paragraph" }] });
    assert.deepEqual(fromMarkdoc(null), { type: "doc", content: [{ type: "paragraph" }] });
  });

  it("keeps the words of a Markdoc tag it cannot represent", () => {
    // The editor has no widget for `{% callout %}`. Dropping the tag is fine;
    // dropping the sentence inside it would be losing an editor's work.
    const parsed = fromMarkdoc("{% callout %}\nImportant thing.\n{% /callout %}");
    assert.match(toMarkdoc(parsed), /Important thing\./);
  });

  it("reads a link back as a mark rather than as literal text", () => {
    const parsed = fromMarkdoc("See [the docs](https://example.com).");
    const marks = parsed.content?.[0]?.content?.[1]?.marks;

    assert.equal(marks?.[0]?.type, "link");
    assert.deepEqual(marks?.[0]?.attrs, { href: "https://example.com" });
  });
});

describe("round trips", () => {
  const cases: Array<[name: string, source: string]> = [
    ["a paragraph", "Just some words.\n"],
    ["headings", "## Two\n\n### Three\n"],
    ["emphasis", "**bold** and _italic_ and ~~struck~~\n"],
    ["a link", "[the docs](https://example.com)\n"],
    ["a bulleted list", "- One\n- Two\n- Three\n"],
    ["a numbered list", "1. One\n2. Two\n"],
    ["a quote", "> Quoted words.\n"],
    ["a divider", "Above\n\n---\n\nBelow\n"],
    ["a code span", "Run `pnpm build` first.\n"],
    ["mixed blocks", "## Title\n\nA paragraph.\n\n- One\n- Two\n\n> A quote.\n"],
  ];

  for (const [name, source] of cases) {
    it(`preserves ${name}`, () => {
      assert.equal(roundTrip(source), source);
    });
  }

  it("is stable on a second pass", () => {
    // The first pass may normalise; the second must not change anything, or
    // opening an entry and closing it would produce a spurious diff.
    for (const [, source] of cases) {
      const once = roundTrip(source);
      assert.equal(roundTrip(once), once);
    }
  });

  it("writes HTML back out escaped, so it stays text", () => {
    const out = toMarkdoc(fromMarkdoc("<script>alert(1)</script>\n"));

    // Every `<` is escaped, which is what makes it inert on the next parse.
    assert.equal(out, "\\<script>alert(1)\\</script>\n");
    assert.doesNotMatch(out, /(^|[^\\])</);

    // And it is still the editor's text: a round trip does not eat it, and a
    // second pass does not accumulate backslashes.
    assert.equal(
      fromMarkdoc(out).content?.[0]?.content?.[0]?.text,
      "<script>alert(1)</script>",
    );
    assert.equal(roundTrip(out), out);
  });
});

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

import { getSchema } from "@tiptap/core";

import {
  equivalentMarkdoc,
  fromMarkdoc,
  toMarkdoc,
  unsupportedMarkdoc,
  type ProseMirrorNode,
} from "../src/lib/markdoc.js";
import { createRichTextExtensions, richTextSchema } from "../src/lib/rich-text-extensions.js";

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
    ["a fenced code block", "```ts\nconst ready = true;\n```\n"],
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

describe("Tiptap schema", () => {
  it("accepts inline and fenced code from stored Markdoc", () => {
    const parsed = fromMarkdoc("Run `rush build`.\n\n```ts\nconst ready = true;\n```\n");
    const schema = getSchema(createRichTextExtensions());

    assert.doesNotThrow(() => schema.nodeFromJSON(parsed));
    assert.equal(parsed.content?.[0]?.content?.[1]?.marks?.[0]?.type, "code");
    assert.equal(parsed.content?.[1]?.type, "codeBlock");
  });
});

describe("stored Markdoc that a toolbar does not offer", () => {
  // The schema is the same for every toolbar, so one check covers them all.
  const schema = getSchema(createRichTextExtensions());
  const samples = [
    "# Title\n\n#### Small heading\n",
    "- one\n- two\n\n1. first\n2. second\n",
    "> A quote\n\n---\n\n~~gone~~ and [a link](https://example.com)\n",
  ];

  for (const sample of samples) {
    it(`loads and writes back ${JSON.stringify(sample.slice(0, 20))} unchanged`, () => {
      const parsed = fromMarkdoc(sample);
      assert.doesNotThrow(() => schema.nodeFromJSON(parsed).check());
      assert.equal(toMarkdoc(parsed), sample);
      assert.deepEqual(unsupportedMarkdoc(sample), []);
    });
  }
});

describe("text that once broke the editor", () => {
  it("keeps code inside a link or bold, and the schema accepts it", () => {
    for (const sample of ["[`npm i`](https://example.com)\n", "**`x`** and _`y`_\n"]) {
      const parsed = fromMarkdoc(sample);
      assert.doesNotThrow(() => richTextSchema.nodeFromJSON(parsed));
      assert.equal(toMarkdoc(parsed), sample);
    }
  });

  it("keeps the start number of an ordered list", () => {
    assert.equal(toMarkdoc(fromMarkdoc("3. third\n4. fourth\n")), "3. third\n4. fourth\n");
  });

  it("never writes a divider that starts front matter", () => {
    const doc = { type: "doc", content: [{ type: "horizontalRule" }, { type: "paragraph", content: [{ type: "text", text: "Hello" }] }, { type: "horizontalRule" }] };
    const out = toMarkdoc(doc);
    assert.equal(out, "***\n\nHello\n\n---\n");
    assert.deepEqual(unsupportedMarkdoc(out), []);
    assert.equal(toMarkdoc(fromMarkdoc(out)), out);
  });
});

describe("unsupportedMarkdoc", () => {
  it("names front matter and variables", () => {
    assert.deepEqual(unsupportedMarkdoc("---\ntitle: x\n---\n\nHello\n"), ["front matter"]);
    assert.deepEqual(unsupportedMarkdoc("Hello {% $name %}.\n"), ["a variable such as {% $name %}"]);
  });

  it("names what the editor cannot show", () => {
    assert.deepEqual(unsupportedMarkdoc("Text ![A house](media/house.jpg) more\n"), ["an image inside a line of text"]);
    assert.deepEqual(unsupportedMarkdoc('![A house](media/house.jpg "Title")\n'), ["an image title"]);
    assert.deepEqual(unsupportedMarkdoc("| a | b |\n| :- | - |\n| 1 | 2 |\n"), ["a table with aligned columns"]);
    assert.deepEqual(unsupportedMarkdoc("| a |\n| --- |\n| ![x](media/x.jpg) |\n"), ["an image inside a line of text"]);
    assert.deepEqual(unsupportedMarkdoc("{% callout %}\nCareful.\n{% /callout %}\n"), ["a {% callout %} tag"]);
    assert.deepEqual(unsupportedMarkdoc("# Title {% #intro %}\n"), ["an attribute such as {% .class %}"]);
    assert.deepEqual(unsupportedMarkdoc('[x](https://example.com "Title")\n'), ["a link title"]);
  });

  it("finds nothing in plain text, code, or an empty field", () => {
    assert.deepEqual(unsupportedMarkdoc("Run `rush build`.\n\n```ts\nconst a = 1;\n```\n"), []);
    assert.deepEqual(unsupportedMarkdoc(null), []);
    assert.deepEqual(unsupportedMarkdoc("  \n"), []);
  });
});

describe("equivalentMarkdoc", () => {
  it("treats the serializers' trailing-newline difference as no change", () => {
    // The server returns the stored body without a trailing newline; toMarkdoc
    // emits one. A form that saved must not become dirty over that gap.
    assert.equal(equivalentMarkdoc("Hello **there**\n", "Hello **there**"), true);
  });

  it("treats null, undefined and empty as the same absent document", () => {
    assert.equal(equivalentMarkdoc(null, ""), true);
    assert.equal(equivalentMarkdoc(undefined, null), true);
    assert.equal(equivalentMarkdoc("", "  \n"), true);
  });

  it("still sees a real edit", () => {
    assert.equal(equivalentMarkdoc("Hello\n", "Hello there\n"), false);
    assert.equal(equivalentMarkdoc("Hello\n", null), false);
  });
});

describe("tables and images", () => {
  const samples = {
    "a table": "| Option | Default |\n| --- | --- |\n| `root` | **./content** |\n| [Link](/docs/) | a \\| b |\n",
    "a table with an empty cell": "| A | B |\n| --- | --- |\n| 1 |  |\n",
    "an image on its own line": "Before.\n\n![A house by the sea](media/house.jpg)\n\nAfter.\n",
    "an image from the shared folder": "![Logo](/media/logo.png)\n",
  };

  for (const [name, source] of Object.entries(samples)) {
    it(`loads and writes back ${name} unchanged, with nothing unsupported`, () => {
      assert.deepEqual(unsupportedMarkdoc(source), []);
      assert.equal(roundTrip(source), source);
      assert.doesNotThrow(() => richTextSchema.nodeFromJSON(fromMarkdoc(source)));
    });
  }

  it("writes a header row for a table that has none, and one line per cell", () => {
    const cell = (type: string, ...content: ProseMirrorNode[]) => ({ type, content: [{ type: "paragraph", content }] });
    const doc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("tableCell", text("a")), cell("tableCell", text("b"))] },
            { type: "tableRow", content: [cell("tableCell", text("one"), { type: "hardBreak" }, text("two"))] },
          ],
        },
      ],
    };
    assert.equal(toMarkdoc(doc), "| a | b |\n| --- | --- |\n| one two |  |\n");
  });

  it("writes alt text as it is, because Markdoc shows it as written", () => {
    const doc = { type: "doc", content: [{ type: "image", attrs: { src: "media/x.jpg", alt: "A *bold* plan" } }] };
    assert.equal(toMarkdoc(doc), "![A *bold* plan](media/x.jpg)\n");
    assert.equal(roundTrip(toMarkdoc(doc)), toMarkdoc(doc));
  });

  it("encodes a path with a space, a bracket or a letter outside ASCII, and keeps it on a second pass", () => {
    const doc = { type: "doc", content: [{ type: "image", attrs: { src: "media/Team photo (1) zürich.jpg", alt: "Team" } }] };
    const written = toMarkdoc(doc);
    assert.equal(written, "![Team](media/Team%20photo%20%281%29%20z%C3%BCrich.jpg)\n");
    assert.deepEqual(unsupportedMarkdoc(written), []);
    assert.equal(roundTrip(written), written);
  });

  it("leaves numbers in cells and at the start of a line as they are", () => {
    const source = "| Rate | Date |\n| --- | --- |\n| 3.5 | 13.10.2026 |\n| -5 | #1 |\n\n-5 degrees and 3.5 million\n";
    assert.equal(roundTrip(source), source);
  });

  it("keeps a table read-only when a row has more cells than the header", () => {
    assert.deepEqual(unsupportedMarkdoc("| a |\n| --- |\n| 1 | 2 |\n"), ["a table row with more cells than the header"]);
    assert.deepEqual(unsupportedMarkdoc("Text.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nMore.\n"), []);
  });

  it("keeps an image in a list read-only", () => {
    assert.deepEqual(unsupportedMarkdoc("- ![a](media/x.jpg)\n\n- b\n"), ["an image in a list"]);
  });
});

/**
 * The bridge between the editor and the file on disk.
 *
 * Rich text is stored as Markdoc — a `.mdoc` file beside the entry — because
 * that is what a reviewer reads in a diff and what the Astro build renders.
 * Tiptap, which is what makes the editing feel like a word processor, speaks
 * ProseMirror JSON and would happily hand us HTML instead. HTML is the wrong
 * thing to write: it is unreadable in a diff, it carries styling decisions that
 * belong to the website, and it is the one format that can smuggle a script
 * into a static build.
 *
 * So the conversion happens here, at the boundary, and nothing above it has to
 * know that two representations exist.
 *
 * Only the nodes the field DSL can enable are handled. That is not a gap: the
 * editor's schema is built from the same list, so a node outside it cannot be
 * produced in the first place.
 */

import Markdoc, { type Node as MarkdocNode } from "@markdoc/markdoc";

/* ------------------------------------------------------------------ *
 * ProseMirror JSON, as much of it as we produce
 * ------------------------------------------------------------------ */

export interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: Mark[];
}

/* ------------------------------------------------------------------ *
 * Tiptap  ->  Markdoc
 * ------------------------------------------------------------------ */

/**
 * Characters that would otherwise be read back as formatting.
 *
 * Deliberately conservative: escaping too much produces backslashes an editor
 * never typed and can see in the diff, while escaping too little silently
 * changes their text. These are the ones that actually round-trip wrong.
 */
function escapeText(text: string): string {
  return text
    // `<` is in the set because CommonMark passes raw HTML through. An editor
    // who types "<script>" means those characters, and writing them unescaped
    // would put live markup in a file the build renders.
    .replace(/([\\`*_[\]<])/g, "\\$1")
    // Only at the start of a line, where they would begin a block.
    .replace(/^(\s*)([#>-])/gm, "$1\\$2")
    .replace(/^(\s*\d+)\./gm, "$1\\.");
}

/** Wraps a run of text in the delimiters for its marks. */
function applyMarks(text: string, marks: Mark[] = []): string {
  let result = text;

  // Innermost first, so `**` ends up outside `` ` `` rather than inside it.
  if (marks.some((mark) => mark.type === "code")) result = `\`${result}\``;
  if (marks.some((mark) => mark.type === "bold")) result = `**${result}**`;
  if (marks.some((mark) => mark.type === "italic")) result = `_${result}_`;
  if (marks.some((mark) => mark.type === "strike")) result = `~~${result}~~`;

  const link = marks.find((mark) => mark.type === "link");
  if (link) {
    const href = String(link.attrs?.["href"] ?? "");
    result = `[${result}](${href})`;
  }

  return result;
}

function inline(nodes: ProseMirrorNode[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "\\\n";
      if (node.type !== "text") return "";
      // Code spans are literal: escaping inside one would show the backslash.
      const isCode = node.marks?.some((mark) => mark.type === "code") ?? false;
      return applyMarks(isCode ? (node.text ?? "") : escapeText(node.text ?? ""), node.marks);
    })
    .join("");
}

/** Prefixes every line, including the blank ones inside a quote. */
function prefixLines(text: string, first: string, rest: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? first : rest) + line)
    .join("\n")
    .replace(/[ \t]+$/gm, "");
}

function blocks(nodes: ProseMirrorNode[] = []): string {
  return nodes
    .map((node) => block(node))
    .filter((text) => text !== "")
    .join("\n\n");
}

function block(node: ProseMirrorNode): string {
  switch (node.type) {
    case "paragraph":
      return inline(node.content);

    case "heading": {
      const level = Number(node.attrs?.["level"] ?? 2);
      return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inline(node.content)}`;
    }

    case "blockquote":
      return prefixLines(blocks(node.content), "> ", "> ");

    case "horizontalRule":
      return "---";

    case "codeBlock": {
      const language = String(node.attrs?.["language"] ?? "");
      const text = node.content?.map((child) => child.text ?? "").join("") ?? "";
      return `\`\`\`${language}\n${text}\n\`\`\``;
    }

    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const start = Number(node.attrs?.["start"] ?? 1);

      return (node.content ?? [])
        .map((item, index) => {
          const marker = ordered ? `${start + index}. ` : "- ";
          // Continuation lines line up under the text, not the marker, which is
          // what makes a nested list nest rather than start a new one.
          return prefixLines(blocks(item.content), marker, " ".repeat(marker.length));
        })
        .join("\n");
    }

    default:
      // An unknown block still has text in it; losing it would be worse than
      // losing its shape.
      return node.content ? blocks(node.content) : "";
  }
}

/** ProseMirror JSON to a Markdoc document. Empty input gives an empty string. */
export function toMarkdoc(doc: ProseMirrorNode | null | undefined): string {
  if (!doc?.content?.length) return "";
  const text = blocks(doc.content).trim();
  return text === "" ? "" : `${text}\n`;
}

/**
 * Whether two Markdoc sources describe the same stored document.
 *
 * The two sides of the form serialize differently around the edges — this file
 * emits a trailing newline, the server returns the body without one — and no
 * whitespace at either end survives a parse. Equivalence rather than equality
 * is what "did the editor change anything" means, and both directions of the
 * rich text field's sync use this same answer.
 */
export function equivalentMarkdoc(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

/* ------------------------------------------------------------------ *
 * Markdoc  ->  Tiptap
 * ------------------------------------------------------------------ */

const MARK_FOR: Record<string, string> = {
  strong: "bold",
  em: "italic",
  s: "strike",
};

function fromInline(nodes: MarkdocNode[], marks: Mark[]): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];

  for (const node of nodes) {
    if (node.type === "text") {
      const text = String(node.attributes["content"] ?? "");
      if (text !== "") result.push({ type: "text", text, ...(marks.length ? { marks } : {}) });
      continue;
    }

    if (node.type === "softbreak") {
      // A newline inside a paragraph is a space, per CommonMark.
      result.push({ type: "text", text: " ", ...(marks.length ? { marks } : {}) });
      continue;
    }

    if (node.type === "hardbreak") {
      result.push({ type: "hardBreak" });
      continue;
    }

    // A code span carries its text as an attribute rather than as children,
    // because what is inside it is literal.
    if (node.type === "code") {
      const content = String(node.attributes["content"] ?? "");
      if (content !== "") {
        result.push({ type: "text", text: content, marks: [...marks, { type: "code" }] });
      }
      continue;
    }

    if (node.type === "link") {
      result.push(
        ...fromInline(node.children, [
          ...marks,
          { type: "link", attrs: { href: String(node.attributes["href"] ?? "") } },
        ]),
      );
      continue;
    }

    const mark = MARK_FOR[node.type];
    if (mark) {
      result.push(...fromInline(node.children, [...marks, { type: mark }]));
      continue;
    }

    // Anything else — including a Markdoc `{% tag %}` — contributes its text.
    // The editor cannot represent the tag, and dropping the words with it
    // would quietly delete an editor's content.
    result.push(...fromInline(node.children, marks));
  }

  return result;
}

function fromBlocks(nodes: MarkdocNode[]): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];

  for (const node of nodes) {
    switch (node.type) {
      // A tight list item holds its inlines directly, with no paragraph in
      // between. ProseMirror always wants a block, so supply one.
      case "inline":
        result.push({ type: "paragraph", content: fromInline(node.children, []) });
        break;

      case "paragraph": {
        // Markdoc wraps a paragraph's inlines in an `inline` node.
        const content = fromInline(
          node.children.flatMap((child) => (child.type === "inline" ? child.children : [child])),
          [],
        );
        result.push({ type: "paragraph", ...(content.length ? { content } : {}) });
        break;
      }

      case "heading": {
        const content = fromInline(
          node.children.flatMap((child) => (child.type === "inline" ? child.children : [child])),
          [],
        );
        result.push({
          type: "heading",
          attrs: { level: Number(node.attributes["level"] ?? 2) },
          ...(content.length ? { content } : {}),
        });
        break;
      }

      case "blockquote":
        result.push({ type: "blockquote", content: fromBlocks(node.children) });
        break;

      case "hr":
        result.push({ type: "horizontalRule" });
        break;

      case "fence":
        result.push({
          type: "codeBlock",
          attrs: { language: String(node.attributes["language"] ?? "") || null },
          content: [{ type: "text", text: String(node.attributes["content"] ?? "").trimEnd() }],
        });
        break;

      case "list": {
        const ordered = node.attributes["ordered"] === true;
        result.push({
          type: ordered ? "orderedList" : "bulletList",
          content: node.children
            .filter((child) => child.type === "item")
            .map((item) => ({ type: "listItem", content: fromBlocks(item.children) })),
        });
        break;
      }

      case "item":
        result.push({ type: "listItem", content: fromBlocks(node.children) });
        break;

      default:
        result.push(...fromBlocks(node.children));
    }
  }

  return result;
}

/** A Markdoc document as ProseMirror JSON the editor can load. */
export function fromMarkdoc(source: string | null | undefined): ProseMirrorNode {
  if (!source?.trim()) return { type: "doc", content: [{ type: "paragraph" }] };

  const content = fromBlocks(Markdoc.parse(source).children);

  // ProseMirror refuses an empty document; a paragraph is its idea of blank.
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

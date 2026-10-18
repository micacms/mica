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
 * Only the nodes the editor can show are handled: also a pipe table, and an
 * image on a line of its own. Stored Markdoc with any other node — an image
 * inside a line of text, a table with aligned columns, a `{% tag %}` — is found
 * by `unsupportedMarkdoc` first, and the field shows it read-only instead of
 * converting it, because a conversion would drop it.
 */

import Markdoc, { type Node as MarkdocNode } from "@markdoc/markdoc";

/* ------------------------------------------------------------------ *
 * ProseMirror JSON, as much of it as we produce
 * ------------------------------------------------------------------ */

interface Mark {
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
function escapeText(text: string, inCell = false): string {
  // `<` is in the set because CommonMark passes raw HTML through. An editor
  // who types "<script>" means those characters, and writing them unescaped
  // would put live markup in a file the build renders. `{%` would start a tag.
  const inline = text.replace(/([\\`*_[\]<]|\{(?=%))/g, "\\$1");
  // A table cell is never the start of a line in the file.
  if (inCell) return inline;
  return inline
    // Only at the start of a line, where they would begin a block: `#` and a
    // number with a dot only before a space, as a heading and a list need it;
    // `-` except before a digit, so "-5" stays as it is.
    .replace(/^(\s*)(>|#(?=\s|$)|-(?!\d))/gm, "$1\\$2")
    .replace(/^(\s*\d+)\.(?=\s|$)/gm, "$1\\.");
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

function inline(nodes: ProseMirrorNode[] = [], inCell = false): string {
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return inCell ? " " : "\\\n";
      if (node.type !== "text") return "";
      // Code spans are literal: escaping inside one would show the backslash.
      const isCode = node.marks?.some((mark) => mark.type === "code") ?? false;
      return applyMarks(isCode ? (node.text ?? "") : escapeText(node.text ?? "", inCell), node.marks);
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

/** `---` as the first line would start front matter, which Markdoc hides. */
function document(nodes: ProseMirrorNode[]): string {
  const text = blocks(nodes);
  return text.startsWith("---") ? `***${text.slice(3)}` : text;
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

    case "image": {
      // Markdoc shows alt text as written, so it gets no escapes; the dialog refuses brackets.
      const alt = String(node.attrs?.["alt"] ?? "");
      return `![${alt}](${imagePath(String(node.attrs?.["src"] ?? ""))})`;
    }

    case "table":
      return table(node);

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

/**
 * A pipe table. The first row is the header, as Markdown requires. A cell is
 * one line, so a line break in it becomes a space, and `|` gets a backslash.
 */
function table(node: ProseMirrorNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((child) => inline(child.content, true))
        .join(" ")
        .replace(/\|/g, "\\|"),
    ),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
  return [line(rows[0]!), line(Array<string>(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

/** A path as Markdown reads it: a space, a bracket or a letter outside ASCII is percent-encoded. */
function imagePath(src: string): string {
  return /[\s()<>]|[^\x00-\x7f]/.test(src) ? encodeURI(src).replace(/\(/g, "%28").replace(/\)/g, "%29") : src;
}

/** ProseMirror JSON to a Markdoc document. Empty input gives an empty string. */
export function toMarkdoc(doc: ProseMirrorNode | null | undefined): string {
  if (!doc?.content?.length) return "";
  const text = document(doc.content).trim();
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
        const inlines = node.children.flatMap((child) => (child.type === "inline" ? child.children : [child]));
        const image = loneImage(inlines);
        if (image) {
          result.push({ type: "image", attrs: { src: String(image.attributes["src"] ?? ""), alt: String(image.attributes["alt"] ?? "") } });
          break;
        }
        const content = fromInline(inlines, []);
        result.push({ type: "paragraph", ...(content.length ? { content } : {}) });
        break;
      }

      case "table": {
        const rows = node.children.flatMap((part) => part.children.filter((row) => row.type === "tr"));
        result.push({
          type: "table",
          content: rows.map((row, index) => ({
            type: "tableRow",
            content: row.children.map((cell) => {
              const content = fromInline(cell.children.flatMap((child) => (child.type === "inline" ? child.children : [child])), []);
              return {
                type: index === 0 ? "tableHeader" : "tableCell",
                content: [{ type: "paragraph", ...(content.length ? { content } : {}) }],
              };
            }),
          })),
        });
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
        const start = Number(node.attributes["start"] ?? 1);
        result.push({
          type: ordered ? "orderedList" : "bulletList",
          ...(ordered && start !== 1 ? { attrs: { start } } : {}),
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

/** The image of a paragraph that holds nothing else, which the editor shows as an image block. */
function loneImage(inlines: MarkdocNode[]): MarkdocNode | undefined {
  const meaningful = inlines.filter((node) => !(node.type === "text" && String(node.attributes["content"] ?? "").trim() === ""));
  return meaningful.length === 1 && meaningful[0]!.type === "image" ? meaningful[0] : undefined;
}

/** The Markdoc node types that the editor can show and write back unchanged. */
const SUPPORTED = new Set([
  "document", "paragraph", "inline", "text", "softbreak", "hardbreak", "strong", "em", "s", "code",
  "link", "heading", "blockquote", "hr", "fence", "list", "item",
  "table", "thead", "tbody", "tr", "th", "td", "image",
]);

const NAMES: Record<string, string> = { html: "HTML", comment: "a comment" };

/** Whether a body row of a table has more cells than its header: Markdown drops them, and a save would lose them. */
function widerRows(source: string, table: MarkdocNode): boolean {
  const [first, last] = [table.lines[0], table.lines.at(-1)];
  if (first === undefined || last === undefined) return false;
  const cells = (line: string) =>
    line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).length;
  const rows = source.split("\n").slice(first, last).filter((line) => line.trim() !== "");
  const header = rows[0] === undefined ? 0 : cells(rows[0]);
  return rows.slice(2).some((row) => cells(row) > header);
}

/**
 * What a stored document has that the editor cannot show, in words, such as
 * `["an image", "a {% callout %} tag"]`. Empty when the editor can load it.
 */
export function unsupportedMarkdoc(source: string | null | undefined): string[] {
  return source?.trim() ? unsupportedIn(source, Markdoc.parse(source)) : [];
}

function unsupportedIn(source: string, ast: MarkdocNode): string[] {
  const found = new Set<string>();

  // `ancestors` is the path from the document down to the parent of `node`.
  const visit = (node: MarkdocNode, ancestors: MarkdocNode[]): void => {
    const parent = ancestors.at(-1);
    if (node.type === "document" && node.attributes["frontmatter"]) found.add("front matter");
    // A variable or a function, such as `{% $name %}`, is a text node without a string.
    if (node.type === "text" && typeof node.attributes["content"] !== "string") found.add("a variable such as {% $name %}");
    if (node.type === "tag") found.add(`a {% ${node.tag ?? ""} %} tag`);
    else if (!SUPPORTED.has(node.type)) found.add(NAMES[node.type] ?? `a "${node.type}" node`);
    else if (node.type === "link" && node.attributes["title"]) found.add("a link title");
    else if ((node.type === "th" || node.type === "td") && node.attributes["align"]) found.add("a table with aligned columns");
    else if (node.type === "table" && widerRows(source, node)) found.add("a table row with more cells than the header");
    else if (node.type === "image") {
      const paragraph = ancestors.at(-2);
      const alone = parent?.type === "inline" && paragraph?.type === "paragraph" && loneImage(parent.children) === node;
      if (node.attributes["title"]) found.add("an image title");
      else if (!alone || ancestors.some((ancestor) => ancestor.type === "table")) found.add("an image inside a line of text");
      else if (ancestors.some((ancestor) => ancestor.type === "item")) found.add("an image in a list");
    } else if ((node.type === "list" || node.type === "fence" || node.type === "table" || node.type === "blockquote") && ancestors.some((ancestor) => ancestor.type === "table")) {
      found.add("a block inside a table");
    }
    if (node.annotations.length > 0) found.add("an attribute such as {% .class %}");
    if (node.errors.length > 0) found.add("Markdoc that does not parse");
    for (const child of node.children) visit(child, [...ancestors, node]);
  };

  visit(ast, []);
  return [...found];
}

/** A Markdoc document as ProseMirror JSON the editor can load. */
export function fromMarkdoc(source: string | null | undefined): ProseMirrorNode {
  return source?.trim() ? docFrom(Markdoc.parse(source)) : docFrom(null);
}

function docFrom(ast: MarkdocNode | null): ProseMirrorNode {
  const content = ast ? fromBlocks(ast.children) : [];
  // ProseMirror refuses an empty document; a paragraph is its idea of blank.
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** `unsupportedMarkdoc` and `fromMarkdoc` with one parse, for the field as it loads. */
export function readMarkdoc(source: string | null | undefined): { unsupported: string[]; doc: ProseMirrorNode } {
  if (!source?.trim()) return { unsupported: [], doc: docFrom(null) };
  const ast = Markdoc.parse(source);
  return { unsupported: unsupportedIn(source, ast), doc: docFrom(ast) };
}

/**
 * HTML → Markdoc, for the migration only.
 *
 * Rich text used to be stored as a sanitised HTML fragment. It is Markdoc now,
 * which is the whole reason the format is worth having: a `.mdoc` file is a
 * document a person can read and a reviewer can diff, and it keeps executable
 * markup out of the canonical content.
 *
 * The input is not arbitrary HTML. It is what the editor produced under a
 * schema that admits exactly the nodes and marks `RichTextFeature` declares, so
 * this handles that closed set and refuses to guess at anything else — an
 * unrecognised element contributes its text and nothing more. Silent, careful
 * degradation is right here: the alternative is a migration that stops on the
 * first surprise in someone's content.
 *
 * Deleted once every site has been migrated.
 */

import { parseFragment } from "parse5";

/**
 * The parse5 node shapes this file touches.
 *
 * Declared here rather than imported: parse5 publishes no subpath export for
 * its tree-adapter types, and structural types for the four properties actually
 * read are both sufficient and a clearer statement of what is depended on.
 */
interface TextNode {
  nodeName: "#text";
  value: string;
}

interface Element {
  nodeName: string;
  tagName: string;
  attrs: Array<{ name: string; value: string }>;
  childNodes: ChildNode[];
}

type ChildNode = TextNode | Element | { nodeName: string };

export function htmlToMarkdoc(html: string): string {
  const fragment = parseFragment(html) as unknown as { childNodes: ChildNode[] };
  const blocks = fragment.childNodes.flatMap((node) => convertBlock(node, ""));

  return blocks
    .filter((block) => block.trim() !== "")
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

function convertBlock(node: ChildNode, indent: string): string[] {
  if (isText(node)) {
    const text = escapeText(node.value).trim();
    return text === "" ? [] : [indent + text];
  }

  if (!isElement(node)) return [];

  const children = () => node.childNodes.flatMap((child) => convertBlock(child, indent));

  switch (node.nodeName) {
    case "p":
      return [indent + inline(node)];

    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return [`${indent}${"#".repeat(Number(node.nodeName.slice(1)))} ${inline(node)}`];

    case "hr":
      return [`${indent}---`];

    case "br":
      return [];

    case "ul":
    case "ol":
      return [list(node, indent)];

    case "blockquote":
      // Every line gets the marker, including the blank ones between
      // paragraphs — otherwise the quote ends at the first of them.
      return [
        node.childNodes
          .flatMap((child) => convertBlock(child, ""))
          .join("\n\n")
          .split("\n")
          .map((line) => `${indent}> ${line}`.trimEnd())
          .join("\n"),
      ];

    case "pre": {
      const text = textOf(node);
      return [`${indent}\`\`\`\n${text}\n${indent}\`\`\``];
    }

    // A wrapper the editor emitted for its own reasons. Its children are the
    // content; the element itself means nothing here.
    default:
      return children();
  }
}

function list(node: Element, indent: string): string {
  const ordered = node.nodeName === "ol";
  const items = node.childNodes.filter(
    (child: ChildNode) => isElement(child) && child.nodeName === "li",
  );

  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : "- ";
      const inner = indent + " ".repeat(marker.length);

      // A list item holds inline content, and may hold a nested list after it.
      const own = (item as Element).childNodes.filter(
        (child: ChildNode) =>
          !(isElement(child) && (child.nodeName === "ul" || child.nodeName === "ol")),
      );
      const nested = (item as Element).childNodes.filter(
        (child: ChildNode) => isElement(child) && (child.nodeName === "ul" || child.nodeName === "ol"),
      );

      const head = `${indent}${marker}${inlineOf(own).trim()}`;
      const tail = nested.map((child) => list(child as Element, inner));

      return [head, ...tail].join("\n");
    })
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * Inline
 * ------------------------------------------------------------------ */

function inline(node: Element): string {
  return inlineOf(node.childNodes);
}

function inlineOf(nodes: ChildNode[]): string {
  return nodes.map(inlineNode).join("").replace(/[ \t]+/g, " ");
}

function inlineNode(node: ChildNode): string {
  if (isText(node)) return escapeText(node.value);
  if (!isElement(node)) return "";

  const inner = inline(node);

  switch (node.nodeName) {
    case "strong":
    case "b":
      return inner.trim() === "" ? inner : `**${inner.trim()}**`;

    case "em":
    case "i":
      return inner.trim() === "" ? inner : `_${inner.trim()}_`;

    case "s":
    case "del":
    case "strike":
      return inner.trim() === "" ? inner : `~~${inner.trim()}~~`;

    case "code":
      return `\`${textOf(node)}\``;

    case "a": {
      const href = attribute(node, "href");
      if (!href) return inner;
      const title = attribute(node, "title");
      return `[${inner.trim()}](${href}${title ? ` "${title}"` : ""})`;
    }

    case "br":
      // Two trailing spaces is the only line break Markdown has that survives
      // inside a paragraph.
      return "  \n";

    default:
      return inner;
  }
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

/**
 * Escapes what Markdoc would otherwise read as markup.
 *
 * Conservative: only the characters that begin a construct, and `#`/`-`/digits
 * only where they begin a line. Escaping every asterisk in prose would leave
 * backslashes all over content that never had any markup in it.
 */
function escapeText(value: string): string {
  return value
    .replace(/([\\`*_{}[\]<>])/g, "\\$1")
    .replace(/^(\s*)([#>-])/gm, "$1\\$2")
    .replace(/^(\s*\d+)\./gm, "$1\\.");
}

function textOf(node: Element): string {
  return node.childNodes
    .map((child) => (isText(child) ? child.value : isElement(child) ? textOf(child) : ""))
    .join("");
}

function attribute(node: Element, name: string): string | undefined {
  return node.attrs.find((attr) => attr.name === name)?.value;
}

function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

function isText(node: ChildNode): node is TextNode {
  return node.nodeName === "#text";
}

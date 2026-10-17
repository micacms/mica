/**
 * Links and images inside rich text. Markdoc stores a path as the editor wrote
 * it: from the document's folder, such as `media/house.jpg`, or from the
 * content root with `/`. The server, the Astro loader and `mica check` read the
 * paths with these same rules.
 */

import type { RichTextFeature, RichTextToolbar } from "./types.js";

/** The features of each toolbar preset. */
export const RICH_TEXT_TOOLBARS: Record<Exclude<RichTextToolbar, RichTextFeature[]>, readonly RichTextFeature[]> = {
  minimal: ["bold", "italic", "link"],
  default: ["bold", "italic", "heading", "bulletList", "orderedList", "link"],
  full: ["bold", "italic", "strike", "heading", "bulletList", "orderedList", "blockquote", "link", "horizontalRule", "table", "image"],
};

/** The features that a field's `toolbar` gives: a preset's list, the list itself, or the default. */
export function richTextFeatures(toolbar: RichTextToolbar | undefined): readonly RichTextFeature[] {
  if (toolbar === undefined) return RICH_TEXT_TOOLBARS.default;
  return typeof toolbar === "string" ? RICH_TEXT_TOOLBARS[toolbar] : toolbar;
}

/**
 * The targets of the images and links in Markdoc: `![alt](media/x.jpg)`,
 * `[Price list](/media/prices.pdf)`, a reference `[x]: media/x.jpg`, and a tag
 * attribute such as `{% figure src="media/x.jpg" %}`.
 */
export function markdocTargets(text: string): string[] {
  const inline = [...text.matchAll(/\]\(\s*<?([^)\s>]+)/g)].map((match) => match[1]!);
  const references = [...text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)/gm)].map((match) => match[1]!);
  const attributes = [...text.matchAll(/\{%[^%]*%\}/g)].flatMap((tag) =>
    [...tag[0].matchAll(/\b[\w-]+\s*=\s*"([^"]+)"/g)].map((match) => match[1]!),
  );
  return [...inline, ...references, ...attributes];
}

/** Markdoc without its code blocks and code spans, where `![…](…)` is text, not an image. */
function withoutCode(text: string): string {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

/** The paths of the images in Markdoc, `![alt](media/x.jpg)` or `![alt](<media/x y.jpg>)`, as written. Code is left out. */
export function markdocImages(text: string): string[] {
  return [...withoutCode(text).matchAll(/!\[(?:[^\]\\]|\\.)*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))/g)].map((match) => (match[1] ?? match[2])!);
}

/** An address on the web, an address of another kind such as `mailto:`, or an anchor: not a file of the content. */
export function isWebAddress(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || target.startsWith("#");
}

/** A rich-text target as a content path: from the content root with `/`, else from the document's folder. */
export function resolveMarkdocTarget(target: string, folder: string): string | null {
  if (isWebAddress(target)) return null;
  let decoded: string;
  try {
    decoded = decodeURI(target.split(/[?#]/)[0]!);
  } catch {
    return null;
  }
  const joined = decoded.startsWith("/") ? decoded.slice(1) : folder === "" ? decoded : `${folder}/${decoded}`;
  const normal = normalize(joined);
  return normal.startsWith("..") ? null : normal;
}

/** `a/./b/../c` as `a/c`, without `node:path`: this module also runs in the browser. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/**
 * Links and images inside rich text. Markdoc stores a path as the editor wrote
 * it: from the document's folder, such as `media/house.jpg`, or from the
 * content root with `/`. The server, the Astro loader and `mica check` read the
 * paths with these same rules.
 */

import type { FieldMap, RichTextFeature, RichTextToolbar } from "./types.js";

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

/** Every rich-text value in a payload with its dotted field path, nested fields included. */
export function richTextDocuments(fields: FieldMap, data: Record<string, unknown>): Array<{ field: string; text: string }> {
  const found: Array<{ field: string; text: string }> = [];
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const visit = (map: FieldMap, record: Record<string, unknown>, prefix: string) => {
    for (const [key, field] of Object.entries(map)) {
      const value = record[key];
      const here = prefix ? `${prefix}.${key}` : key;
      if (field.kind === "richText" && typeof value === "string") found.push({ field: here, text: value });
      else if (field.kind === "object" && isRecord(value)) visit(field.fields, value, here);
      else if (field.kind === "repeater" && Array.isArray(value)) {
        value.forEach((row, index) => isRecord(row) && visit(field.fields, row, `${here}.${index}`));
      }
    }
  };
  visit(fields, data, "");
  return found;
}

/** Every rich-text value in a payload, nested fields included. */
export function richTextValues(fields: FieldMap, data: Record<string, unknown>): string[] {
  return richTextDocuments(fields, data).map((document) => document.text);
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

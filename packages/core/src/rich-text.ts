/**
 * Links and images inside rich text. Markdoc stores a path as the editor wrote
 * it: from the document's folder, such as `media/house.jpg`, or from the
 * content root with `/`. The server, the Astro loader and `mica check` read the
 * paths with these same rules.
 */

import type { FieldMap } from "./types.js";

/** Every rich-text value in a payload, nested fields included. */
export function richTextValues(fields: FieldMap, data: Record<string, unknown>): string[] {
  const found: string[] = [];
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const visit = (map: FieldMap, record: Record<string, unknown>) => {
    for (const [key, field] of Object.entries(map)) {
      const value = record[key];
      if (field.kind === "richText" && typeof value === "string") found.push(value);
      else if (field.kind === "object" && isRecord(value)) visit(field.fields, value);
      else if (field.kind === "repeater" && Array.isArray(value)) for (const row of value) if (isRecord(row)) visit(field.fields, row);
    }
  };
  visit(fields, data);
  return found;
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

/** The paths of the images in Markdoc, `![alt](media/x.jpg)`, as written. A scan, not a parse, so code is not left out. */
export function markdocImages(text: string): string[] {
  return [...text.matchAll(/!\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)/g)].map((match) => match[1]!);
}

/** A rich-text target as a content path: from the content root with `/`, else from the document's folder. */
export function resolveMarkdocTarget(target: string, folder: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return null;
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

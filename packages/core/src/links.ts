/**
 * The links of a document, by one rule: relations, media fields, and the
 * images and links in its rich text. The reference check, the media uses, the
 * removal check, the Publish needs and `mica check` all read them here.
 */

import { isWebAddress, markdocImages, markdocTargets, resolveMarkdocTarget } from "./rich-text.js";
import type { FieldMap } from "./types.js";
import { isRecord, mapFields, walkFields } from "./walk.js";

/**
 * One link of a document, with the dotted path of its field. `path` is from the
 * content root. An `image` in rich text has a null `path` when it leaves the
 * content root; a `link` in rich text is one only when it names a content path.
 */
export type DocumentLink =
  | { kind: "relation"; field: string; collection: string; id: string }
  | { kind: "media"; field: string; path: string }
  | { kind: "image"; field: string; target: string; path: string | null }
  | { kind: "link"; field: string; target: string; path: string };

/** Every link of a document whose rich text reads relative paths from `folder`, nested fields included. */
export function documentLinks(fields: FieldMap, data: Record<string, unknown>, folder: string): DocumentLink[] {
  const found: DocumentLink[] = [];
  walkFields(fields, data, (field, value, at) => {
    const here = at.join(".");
    if (field.kind === "relation" || field.kind === "media") {
      const many = Array.isArray(value) ? value : value == null ? [] : [value];
      many.forEach((item, index) => {
        const name = field.multiple ? `${here}.${index}` : here;
        // `media({ alt })` stores `{ path, alt }`.
        const target = field.kind === "media" && isRecord(item) ? item["path"] : item;
        if (typeof target !== "string" || target === "") return;
        found.push(field.kind === "relation" ? { kind: "relation", field: name, collection: field.collection, id: target } : { kind: "media", field: name, path: target });
      });
    } else if (field.kind === "richText" && typeof value === "string") {
      found.push(...richTextLinks(value, folder, here));
    }
  });
  return found;
}

/**
 * The images and links of one rich-text value. A web address is none. Every
 * target counts as a link, also one in code: a file that the text names is in use.
 */
export function richTextLinks(text: string, folder: string, field: string): DocumentLink[] {
  const images = markdocImages(text).filter((target) => !isWebAddress(target));
  const found: DocumentLink[] = images.map((target) => ({ kind: "image", field, target, path: resolveMarkdocTarget(target, folder) }));
  const imageTargets = new Set(images);
  for (const target of markdocTargets(text)) {
    if (imageTargets.has(target)) continue;
    const path = resolveMarkdocTarget(target, folder);
    if (path !== null) found.push({ kind: "link", field, target, path });
  }
  return found;
}

/**
 * The payload with every relation to `collection`/`from` pointing at `to`
 * instead, nested fields included: the links that follow an entry's new URL.
 * Returns null when nothing pointed at `from`.
 */
export function relinkReferences(
  fields: FieldMap,
  data: Record<string, unknown>,
  collection: string,
  from: string,
  to: string,
): Record<string, unknown> | null {
  let changed = false;
  const swap = (id: unknown) => (id === from ? ((changed = true), to) : id);
  const result = mapFields(fields, data, (field, value) => {
    if (field.kind !== "relation" || field.collection !== collection) return value;
    return Array.isArray(value) ? value.map(swap) : swap(value);
  });
  return changed ? result : null;
}

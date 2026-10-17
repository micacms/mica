/**
 * The index of a reference set: the id and title of each item, which the Astro
 * loader writes to `.mica/references/<name>.json` beside the model. Mica reads
 * the index, never the website's file, so the self-hosted Mica needs nothing
 * but the content repository.
 */

import type { ContentSource } from "./source.js";

export const REFERENCES_DIR = ".mica/references";

export const referenceIndexPath = (name: string): string => `${REFERENCES_DIR}/${name}.json`;

export interface ReferenceItem {
  id: string;
  title: string;
}

/** One item on each line, so that a changed item is one changed line in a diff. */
export function serializeReferenceIndex(items: readonly ReferenceItem[]): string {
  if (items.length === 0) return "[]\n";
  return `[\n${items.map((item) => `  ${JSON.stringify({ id: item.id, title: item.title })}`).join(",\n")}\n]\n`;
}

/** The items of an index file. Throws for a file that is not one. */
export function parseReferenceIndex(text: string): ReferenceItem[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("A reference index is a list of { id, title }.");
  return raw.map((item, index) => {
    const { id, title } = (item ?? {}) as { id?: unknown; title?: unknown };
    if (typeof id !== "string" || typeof title !== "string") throw new Error(`Item ${index + 1} of a reference index needs a text id and title.`);
    return { id, title };
  });
}

/** The index of a reference set, or null when it is not in the content. */
export async function readReferenceIndex(source: ContentSource, name: string): Promise<ReferenceItem[] | null> {
  const text = await source.read(referenceIndexPath(name));
  return text === null ? null : parseReferenceIndex(text);
}

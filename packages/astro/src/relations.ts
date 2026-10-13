/**
 * Relations for the website's pages. A relation field stores the target's slug,
 * which is also its id in Astro, so these are `getEntry` with the types and the
 * checks that a page wants: a missing target warns in `astro dev`, and is left
 * out rather than rendered as nothing.
 *
 * A separate entry point (`@micacms/astro/relations`) because it imports
 * `astro:content`, which exists only inside an Astro build, while the main entry
 * is also loaded by `content.config.ts`.
 */

/// <reference types="astro/client" />

import { getEntry, type CollectionEntry, type CollectionKey } from "astro:content";

function warnMissing(collection: string, slug: string): void {
  if (import.meta.env.DEV) {
    console.warn(`[mica] A relation names "${collection}/${slug}", which does not exist. Run \`npx mica check\`.`);
  }
}

/** The entry that a single relation field names, or `undefined` when it is empty or names a missing entry. */
export async function related<C extends CollectionKey>(
  collection: C,
  slug: string | null | undefined,
): Promise<CollectionEntry<C> | undefined> {
  if (!slug) return undefined;
  const entry = (await getEntry(collection, slug)) as CollectionEntry<C> | undefined;
  if (!entry) warnMissing(String(collection), slug);
  return entry;
}

/** The entries that a multiple relation field names, in the editor's order, without missing ones. */
export async function relatedAll<C extends CollectionKey>(
  collection: C,
  slugs: readonly string[] | null | undefined,
): Promise<Array<CollectionEntry<C>>> {
  const entries = await Promise.all((slugs ?? []).map((slug) => related(collection, slug)));
  return entries.filter((entry): entry is CollectionEntry<C> => entry !== undefined);
}

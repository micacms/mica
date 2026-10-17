/** The choices of relation fields: one request per target, shared by every field on the page. */

import { api } from "@/api";

/** An entry of a collection, or an item of a reference set: what a relation stores, and its title. */
export interface RelationOption {
  slug: string;
  title: string;
}

const cache = new Map<string, Promise<RelationOption[]>>();

/** The entries of a collection, or with `reference` the items of a reference set, from the cache of the current page. */
export function entryOptions(target: string, reference = false): Promise<RelationOption[]> {
  const key = `${reference ? "reference" : "collection"}:${target}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = reference
      ? api.references(target).then((result) => result.items.map((item) => ({ slug: item.id, title: item.title })))
      : api.entries.list(target).then((result) => result.items.map((item) => ({ slug: item.slug, title: item.title })));
    // A failed request is asked again by the next field, not kept.
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

/** Called at each page change, so that a new or renamed entry appears. */
export function forgetEntryOptions(): void {
  cache.clear();
}

/** Entry lists for relation fields: one request per collection, shared by every field on the page. */

import { api, type EntrySummary } from "@/api";

const cache = new Map<string, Promise<EntrySummary[]>>();

/** The entries of a collection, from the cache of the current page. */
export function entryOptions(collection: string): Promise<EntrySummary[]> {
  let pending = cache.get(collection);
  if (!pending) {
    pending = api.entries.list(collection).then((result) => result.items);
    // A failed request is asked again by the next field, not kept.
    pending.catch(() => cache.delete(collection));
    cache.set(collection, pending);
  }
  return pending;
}

/** Called at each page change, so that a new or renamed entry appears. */
export function forgetEntryOptions(): void {
  cache.clear();
}

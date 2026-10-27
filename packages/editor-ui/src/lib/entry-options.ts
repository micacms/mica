/** The choices of relation fields: one request per target, shared by every field on the page. */

import { api } from "@/api";
import { pageHref } from "@/lib/pages";

/** An entry of a collection, or an item of a reference set: what a relation stores, its title, and its page. */
export interface RelationOption {
  id: string;
  title: string;
  /** The entry's page, from the collection's `url`; null for an item of a reference set, or without a `url`. */
  url?: string | null;
}

const cache = new Map<string, Promise<RelationOption[]>>();

/**
 * The entries of a collection, or with `reference` the items of a reference
 * set, from the cache of the current page. With the collection's `url`, each
 * entry also has its page's URL, with `locale` as the value of `{locale}`.
 */
export function entryOptions(target: string, reference = false, url?: string | null, locale = ""): Promise<RelationOption[]> {
  // The url is part of the key: a list without the pages' URLs must not stand in for one with them.
  const key = `${reference ? "reference" : "collection"}:${target}:${url ?? ""}:${locale}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = reference
      ? api.references(target).then((result) => result.items.map((item) => ({ id: item.id, title: item.title })))
      : api.entries.list(target).then((result) => toOptions(result.items, url, locale));
    // A failed request is asked again by the next field, not kept.
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

/** The choices of a collection's entries, each with its page's URL when the collection has a `url`. */
export function toOptions(items: ReadonlyArray<{ id: string; title: string; data: Record<string, unknown> }>, url?: string | null, locale = ""): RelationOption[] {
  return items.map((item) => ({ id: item.id, title: item.title, url: url ? pageHref(url, item.id, item.data, locale) : null }));
}

/** Called at each page change, so that a new or renamed entry appears. */
export function forgetEntryOptions(): void {
  cache.clear();
}

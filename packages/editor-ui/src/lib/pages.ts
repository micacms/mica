/**
 * Links to the website: the `page` of a collection or a singleton, which the
 * server builds from `MICA_SITE_URL` and the model's `url`. Only links; Mica
 * never calls the website.
 */

import { pageUrl, idAtPath } from "@micacms/core/internal";

import type { ChangeOwner, Schema } from "@/api";
import { addressLocales, addressOf } from "@/lib/locales";

/**
 * The page of an entry, with the values of `data` for the other names of its
 * address, such as `{activity}`; of a singleton without `id`. `locale` is the
 * value of `{locale}`, from `addressOf`; undefined on a site without locales.
 * Null without a page in the model, or while a value of the address is empty.
 */
export const pageHref = (page: string | null | undefined, id?: string, data?: Record<string, unknown>, locale?: string): string | null =>
  page ? pageUrl(page, id, data, locale) : null;

/** The page that a published change shows on, if the model has one, in the default locale. An address with other names than `{id}` needs the entry's `data`. */
export function pageOfOwner(owner: ChangeOwner, schema: Schema | null, data?: Record<string, unknown> | null): string | null {
  const locale = addressOf(schema?.site?.locales);
  if (owner.kind === "entry") return pageHref(schema?.collections.find((item) => item.name === owner.collection)?.page, owner.id, data ?? undefined, locale);
  if (owner.kind === "singleton") return pageHref(schema?.singletons.find((item) => item.name === owner.name)?.page, undefined, undefined, locale);
  return null;
}

/** A form, and the locale of the page: null for an address without `{locale}`. */
type DocumentAtPath = { name: string; params: Record<string, string>; locale: string | null };

/**
 * The forms of the documents whose page `path` can be, from the model's `url`
 * options, the most specific address first: /news/hello is an article before
 * a page "news/hello". Addresses such as /{activity}/{id} and /{year}/{id}
 * fit the same paths, so the preview takes the first one that the page shows.
 */
export function documentsAtPath(path: string, schema: Schema | null): DocumentAtPath[] {
  const trim = (value: string) => value.replace(/\/+$/, "") || "/";
  const wanted = trim(path);
  const site = addressLocales(schema?.site?.locales);
  const found: Array<DocumentAtPath & { literal: number }> = [];
  for (const item of schema?.collections ?? []) {
    if (!item.url) continue;
    // Each other name of the address, such as {activity}, matches one part of the path.
    const match = idAtPath(trim(item.url), wanted, site);
    if (match) found.push({ name: "entry", params: { collection: item.name, id: match.id }, locale: match.locale, literal: match.literal });
  }
  for (const item of schema?.singletons ?? []) {
    const match = item.url ? idAtPath(trim(item.url), wanted, site) : null;
    // A singleton's address is all its own text: it wins over a collection's pattern.
    if (match) found.push({ name: "singleton", params: { name: item.name }, locale: match.locale, literal: wanted.length + 1 });
  }
  // A stable sort keeps the model's order between addresses that are equally specific.
  return found.sort((a, b) => b.literal - a.literal).map(({ name, params, locale }) => ({ name, params, locale }));
}

/** The form of the document whose page is `path`: the most specific address; null for a page without a document. */
export function documentAtPath(path: string, schema: Schema | null): DocumentAtPath | null {
  return documentsAtPath(path, schema)[0] ?? null;
}

/** The address around an ID field: the parts of a collection's `url` before and after `{id}`. */
export interface PageAddress {
  before: string;
  after: string;
  /** The labels of the fields of the address that are empty: the page has no address until they have a value. */
  missing: string[];
}

/**
 * The address around an ID field, from the collection's `url`, with the other
 * names filled in from the form, as the editor types, and `{locale}` with
 * `locale`. An empty one shows the label of its field, such as ‹Activity›: the
 * page has no address without it.
 */
export function pageAddress(url: string, values: Record<string, unknown>, labelOf: (name: string) => string, locale?: string): PageAddress {
  const missing: string[] = [];
  if (locale !== undefined) url = url.replace("/{locale}", locale ? `/${locale}` : "") || "/";
  const fill = (part: string) =>
    part.replace(/\{([^}]*)\}/g, (_match, name: string) => {
      const value = values[name];
      if (typeof value === "string" && value !== "") return value;
      missing.push(labelOf(name));
      return `‹${labelOf(name)}›`;
    });
  const [before = "", after = ""] = url.split("{id}");
  return { before: fill(before), after: fill(after), missing };
}

/** What a list shows for an entry: the page's URL when the collection has a `url` and the address is complete, else the ID. */
export function entryAddress(url: string | null | undefined, id: string, data: Record<string, unknown>, locale?: string): string {
  return (url ? pageHref(url, id, data, locale) : null) ?? id;
}

/** Where a page moves when its entry gets a new ID: the old address with the saved data, the new one with the form's. */
export function movedPage(
  url: string | null | undefined,
  from: { id: string; data: Record<string, unknown> | undefined },
  to: { id: string; data: Record<string, unknown> },
  locale?: string,
): { from: string; to: string } | null {
  if (!url || !from.id || !to.id) return null;
  const old = pageHref(url, from.id, from.data, locale);
  const next = pageHref(url, to.id, to.data, locale);
  return old && next ? { from: old, to: next } : null;
}


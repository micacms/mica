/**
 * Links to the website: the `page` of a collection or a singleton, which the
 * server builds from `MICA_SITE_URL` and the model's `url`. Only links; Mica
 * never calls the website.
 */

import { pageUrl, slugAtPath } from "@micacms/core/internal";

import type { ChangeOwner, Schema } from "@/api";

/**
 * The page of an entry, with the values of `data` for the other names of its
 * address, such as `{activity}`; of a singleton without `slug`. Null without a
 * page in the model, or while a value of the address is empty.
 */
export const pageHref = (page: string | null | undefined, slug?: string, data?: Record<string, unknown>): string | null =>
  page ? pageUrl(page, slug, data) : null;

/** The page that a published change shows on, if the model has one. An address with other names than `{slug}` needs the entry's `data`. */
export function pageOfOwner(owner: ChangeOwner, schema: Schema | null, data?: Record<string, unknown> | null): string | null {
  if (owner.kind === "entry") return pageHref(schema?.collections.find((item) => item.name === owner.collection)?.page, owner.slug, data ?? undefined);
  if (owner.kind === "singleton") return pageHref(schema?.singletons.find((item) => item.name === owner.name)?.page);
  return null;
}

type DocumentAtPath = { name: string; params: Record<string, string> };

/**
 * The forms of the documents whose page `path` can be, from the model's `url`
 * options, the most specific address first: /news/hello is an article before
 * a page "news/hello". Addresses such as /{activity}/{slug} and /{year}/{slug}
 * fit the same paths, so the preview takes the first one that the page shows.
 */
export function documentsAtPath(path: string, schema: Schema | null): DocumentAtPath[] {
  const trim = (value: string) => value.replace(/\/+$/, "") || "/";
  const wanted = trim(path);
  const found: Array<DocumentAtPath & { literal: number }> = [];
  for (const item of schema?.collections ?? []) {
    if (!item.url) continue;
    // Each other name of the address, such as {activity}, matches one part of the path.
    const match = slugAtPath(trim(item.url), wanted);
    if (match) found.push({ name: "entry", params: { collection: item.name, slug: match.slug }, literal: match.literal });
  }
  for (const item of schema?.singletons ?? []) {
    if (item.url && trim(item.url) === wanted) found.push({ name: "singleton", params: { name: item.name }, literal: wanted.length + 1 });
  }
  // A stable sort keeps the model's order between addresses that are equally specific.
  return found.sort((a, b) => b.literal - a.literal).map(({ name, params }) => ({ name, params }));
}

/** The form of the document whose page is `path`: the most specific address; null for a page without a document. */
export function documentAtPath(path: string, schema: Schema | null): DocumentAtPath | null {
  return documentsAtPath(path, schema)[0] ?? null;
}

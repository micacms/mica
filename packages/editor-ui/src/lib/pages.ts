/**
 * Links to the website: the `page` of a collection or a singleton, which the
 * server builds from `MICA_SITE_URL` and the model's `url`. Only links; Mica
 * never calls the website.
 */

import { pageUrl } from "@micacms/core/internal";

import type { ChangeOwner, Schema } from "@/api";

/** The page of an entry, or of a singleton without `slug`; null without a page in the model. */
export const pageHref = (page: string | null | undefined, slug?: string): string | null => (page ? pageUrl(page, slug) : null);

/** The page that a published change shows on, if the model has one. */
export function pageOfOwner(owner: ChangeOwner, schema: Schema | null): string | null {
  if (owner.kind === "entry") return pageHref(schema?.collections.find((item) => item.name === owner.collection)?.page, owner.slug);
  if (owner.kind === "singleton") return pageHref(schema?.singletons.find((item) => item.name === owner.name)?.page);
  return null;
}

/** The form of the document whose page is `path`, from the model's `url` options; null for a page without a document. */
export function documentAtPath(path: string, schema: Schema | null): { name: string; params: Record<string, string> } | null {
  const trim = (value: string) => value.replace(/\/+$/, "") || "/";
  const wanted = trim(path);
  let best: { name: string; params: Record<string, string>; literal: number } | null = null;
  const consider = (found: { name: string; params: Record<string, string> }, literal: number) => {
    // The most specific address wins: /news/hello is an article, not a page "news/hello".
    if (!best || literal > best.literal) best = { ...found, literal };
  };
  for (const item of schema?.collections ?? []) {
    if (!item.url) continue;
    const [before = "", after = ""] = trim(item.url).split("{slug}");
    if (!wanted.startsWith(before) || !wanted.endsWith(after) || wanted.length <= before.length + after.length) continue;
    const slug = wanted.slice(before.length, wanted.length - after.length);
    if (slug.includes("/")) continue;
    consider({ name: "entry", params: { collection: item.name, slug: decodeURIComponent(slug) } }, before.length + after.length);
  }
  for (const item of schema?.singletons ?? []) {
    if (item.url && trim(item.url) === wanted) consider({ name: "singleton", params: { name: item.name } }, wanted.length + 1);
  }
  if (!best) return null;
  const { name, params } = best;
  return { name, params };
}

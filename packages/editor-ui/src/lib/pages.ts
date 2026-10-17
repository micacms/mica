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

/** A document before and after a pending change, for the Publish page. */

import {
  type Collection,
  type ContentSource,
  entryFolder,
  entryTitle,
  isValidSlug,
  readCollection,
  readCollectionEntry,
  readSingleton,
  relativizeMedia,
  type Site,
} from "@micacms/core/internal";

import { badRequest, notFound } from "../lib/errors.js";
import type { CompareTarget, Comparison } from "./changes.js";

/**
 * Reads one document from `published` and from `staged`. An order target
 * becomes `{ order: [{ slug, title }] }` on each side, in position order.
 */
export async function compareSources(
  model: Site,
  published: ContentSource,
  staged: ContentSource,
  target: CompareTarget,
): Promise<Omit<Comparison, "revisions">> {
  if (target.kind === "singleton") {
    const def = Object.hasOwn(model.singletons, target.name) ? model.singletons[target.name] : undefined;
    if (!def) throw notFound(`There is no singleton called "${target.name}".`);
    return {
      before: await readSingleton(published, def, target.name),
      after: await readSingleton(staged, def, target.name),
    };
  }

  const def = Object.hasOwn(model.collections, target.collection) ? model.collections[target.collection] : undefined;
  if (!def) throw notFound(`There is no collection called "${target.collection}".`);

  if (target.kind === "entry") {
    const from = target.from ?? target.slug;
    for (const slug of [target.slug, from]) {
      if (!isValidSlug(slug)) throw badRequest(`"${slug}" is not a slug.`);
    }
    const old = await readCollectionEntry(published, def, target.collection, from);
    const after = await readCollectionEntry(staged, def, target.collection, target.slug);
    if (from === target.slug) return { before: old, after };

    // A rename: compare the on-disk form, where colocated media paths do not
    // name the entry's folder.
    return {
      before: old && onDisk(def, target.collection, from, old),
      after: after && onDisk(def, target.collection, target.slug, after),
    };
  }

  const ordering = async (source: ContentSource) => {
    const entries = await readCollection(source, def, target.collection);
    if (entries.length === 0) return null;
    return {
      order: entries.map((entry) => ({ slug: entry.slug, title: entryTitle(def, entry.data) })),
    };
  };

  return { before: await ordering(published), after: await ordering(staged) };
}

/** Entry data with media paths as the files store them: relative to the entry's folder. */
export function onDisk(
  def: Collection,
  collection: string,
  slug: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return relativizeMedia(def.fields, data, entryFolder(collection, slug));
}

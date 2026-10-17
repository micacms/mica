/**
 * The links between the documents of a site, by the one rule of core's
 * `documentLinks`: what uses a file, what a pending document needs, and what
 * a removal breaks.
 */

import {
  type Collection,
  type ContentChange,
  type ContentSource,
  documentLinks,
  entryDataPath,
  entryFolder,
  entryTitle,
  type FieldMap,
  readCollection,
  readSingleton,
  type Singleton,
  type Site,
} from "@micacms/core/internal";

import type { ChangeOwner, StagingProblem } from "./changes.js";

/** An entry or settings page that links to an entry or a file. `readOnly`: this build cannot change its links. */
export type Referrer =
  | { kind: "entry"; collection: string; slug: string; title: string; readOnly?: true }
  | { kind: "singleton"; name: string; title: string; readOnly?: true };

/** A collection entry or a singleton, as a scan over the whole site reads it. */
export interface SiteDocument {
  referrer: Referrer;
  def: Collection | Singleton;
  data: Record<string, unknown>;
  /** The folder of its files, from which its rich text reads a relative path. */
  folder: string;
}

export interface ScanOptions {
  /** Only the collections and singletons whose fields pass. */
  where?: (fields: FieldMap) => boolean;
  /** Called for a collection or singleton that cannot be read. Without it, the error is thrown. */
  unreadable?: (def: Collection | Singleton) => void;
}

/** Calls `visit` for every entry and singleton of the site that `source` has. */
export async function scanSite(
  model: Site,
  source: ContentSource,
  visit: (document: SiteDocument) => void,
  options: ScanOptions = {},
): Promise<void> {
  const readable = async <T>(def: Collection | Singleton, read: () => Promise<T>): Promise<T | undefined> => {
    if (!options.unreadable) return read();
    try {
      return await read();
    } catch {
      options.unreadable(def);
      return undefined;
    }
  };

  for (const [name, def] of Object.entries(model.collections)) {
    if (options.where && !options.where(def.fields)) continue;
    const entries = await readable(def, () => readCollection(source, def, name));
    for (const { slug, data } of entries ?? []) {
      visit({ referrer: { kind: "entry", collection: name, slug, title: entryTitle(def, data) }, def, data, folder: entryFolder(name, slug) });
    }
  }
  for (const [name, def] of Object.entries(model.singletons)) {
    if (options.where && !options.where(def.fields)) continue;
    const data = await readable(def, () => readSingleton(source, def, name));
    if (data) visit({ referrer: { kind: "singleton", name, title: def.label }, def, data, folder: entryFolder(name) });
  }
}

/**
 * Where each file is used: in a media field, or as an image or a link in rich
 * text. `unreadable` names the collections and settings that could not be
 * read, where a use cannot be ruled out.
 */
export async function fileUses(
  model: Site,
  source: ContentSource,
  paths: string[],
): Promise<{ uses: Record<string, Referrer[]>; unreadable: string[] }> {
  const uses: Record<string, Referrer[]> = Object.fromEntries(paths.map((path) => [path, []]));
  const unreadable: string[] = [];
  await scanSite(
    model,
    source,
    ({ referrer, def, data, folder }) => {
      const found = new Set<string>();
      for (const link of documentLinks(def.fields, data, folder)) {
        if (link.kind !== "relation" && link.path !== null && Object.hasOwn(uses, link.path)) found.add(link.path);
      }
      for (const path of found) uses[path]!.push(referrer);
    },
    { unreadable: (def) => unreadable.push(def.label) },
  );
  return { uses, unreadable };
}

/** The folder of a data file, from which its rich text reads a relative path. */
export function folderOf(dataPath: string): string {
  return dataPath.slice(0, dataPath.lastIndexOf("/"));
}

/**
 * The new pending files that the document of `dataPath` links to: a linked
 * entry, a media file, or an image or a file in its rich text. Publish takes
 * them along, so that the website never shows a dead link.
 */
export function linkNeeds(
  dataPath: string,
  fields: FieldMap,
  data: Record<string, unknown>,
  created: ReadonlySet<string>,
): string[] {
  const needed = new Set<string>();
  for (const link of documentLinks(fields, data, folderOf(dataPath))) {
    const path = link.kind === "relation" ? entryDataPath(link.collection, link.slug) : link.path;
    if (path !== null && path !== dataPath && created.has(path)) needed.add(path);
  }
  return [...needed];
}

/**
 * Entries and files that the change set removes while another document still
 * links to them. Publishing them would break a link or an image on the site.
 */
export async function brokenByRemoval(
  model: Site,
  source: ContentSource,
  changes: ContentChange[],
  owners: ChangeOwner[],
  /** The changed entries as staged; null for a removed one. */
  entriesByCollection: Map<string, Map<string, Record<string, unknown> | null>>,
  titles: Map<string, string>,
): Promise<StagingProblem[]> {
  const removedEntries = new Map<string, { collection: string; slug: string; renamedTo?: string }>();
  const removedFiles = new Set<string>();
  changes.forEach((change, index) => {
    const owner = owners[index]!;
    if (change.kind !== "delete") return;
    if (owner.kind === "entry") {
      // A URL change removes the old slug: links to it break as with a delete.
      const gone = owner.renamedFrom ?? owner.slug;
      if (!entriesByCollection.get(owner.collection)?.get(gone)) {
        const renamedTo = owner.renamedFrom ? owner.slug : undefined;
        removedEntries.set(`${owner.collection}/${gone}`, { collection: owner.collection, slug: gone, ...(renamedTo ? { renamedTo } : {}) });
      }
    }
    // A file can be a target, also the media of a removed entry; a cleared rich-text file or an order file cannot.
    if (!change.path.endsWith(".json") && !change.path.endsWith(".mdoc")) removedFiles.add(change.path);
  });
  if (removedEntries.size === 0 && removedFiles.size === 0) return [];

  const linkedFrom = new Map<string, string[]>();
  const note = (target: string, from: string) => linkedFrom.set(target, [...(linkedFrom.get(target) ?? []), from]);

  // Only a removal reads the whole site: what links to the removed entry or file can be anywhere.
  // An unreadable collection is reported where it is changed.
  await scanSite(
    model,
    source,
    ({ referrer, def, data, folder }) => {
      const label = referrer.kind === "entry" ? labelEntry(def as Collection, referrer.slug, referrer.title) : def.label;
      for (const link of documentLinks(def.fields, data, folder)) {
        if (link.kind === "relation") {
          const target = `${link.collection}/${link.slug}`;
          if (removedEntries.has(target)) note(target, label);
        } else if (link.path !== null && removedFiles.has(link.path)) {
          note(link.path, label);
        }
      }
    },
    { unreadable: () => {} },
  );

  const problems: StagingProblem[] = [];
  for (const [target, from] of linkedFrom) {
    const entry = removedEntries.get(target);
    const def = entry ? model.collections[entry.collection]! : null;
    const message = entry?.renamedTo
      ? `The URL changes from "${entry.slug}" to "${entry.renamedTo}", and ${from.join(", ")} still link to "${entry.slug}". Change those links first, or publish them together.`
      : `Still linked from ${from.join(", ")}. Remove those links first, or publish them together.`;
    problems.push({
      path: entry ? entryDataPath(entry.collection, entry.slug) : target,
      label: entry && def ? labelEntry(def, entry.slug, titles.get(target)) : target,
      issues: [{ path: "", message }],
    });
  }
  return problems;
}

/** An entry in words: "Project: House A". */
export function labelEntry(def: Collection, slug: string, title: string | undefined): string {
  return `${def.labelSingular ?? def.label}: ${title ?? slug}`;
}

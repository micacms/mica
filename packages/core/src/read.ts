/**
 * Entry discovery.
 *
 * Turns a content directory into payloads, using the layout rules `layout.ts`
 * defines. Nothing here decides where a file belongs, so a directory written by
 * the editor and a directory written by hand are read the same way — and the
 * Astro build and the Mica server read them identically, because they run this
 * same code over different sources.
 */

import { resolveIdField } from "./define.js";
import { DOCUMENT_EXTENSION, FormatError, INDEX_FILE, entryDataPath, entryFolder } from "./layout.js";
import { isValidId } from "./to-id.js";
import { parseEntry } from "./parse.js";
import { readReferenceIndex, referenceIndexPath } from "./references.js";
import { documentLinks, type DocumentLink } from "./links.js";
import type { Collection, FieldMap, Singleton, Site } from "./types.js";
import type { FieldIssue } from "./validation.js";
import type { ContentSource } from "./source.js";
import { isRecord, mapFields } from "./walk.js";

/**
 * Optional manual ordering for a collection, listing IDs in the order an
 * editor arranged them.
 *
 * A separate file rather than a field on each entry, because order is a
 * property of the collection: writing it into the entries would make a single
 * drag rewrite every one of them, and the resulting Git diff would say nothing
 * about what changed.
 */
export const ORDER_FILE = "_order.json";

export interface ContentEntry {
  id: string;
  /** Index in the collection's order — manual when `_order.json` says so. */
  position: number;
  data: Record<string, unknown>;
}

/** Raised with the offending path attached, which a bare parse error lacks. */
export class ContentReadError extends Error {
  override name = "ContentReadError";
  constructor(
    message: string,
    readonly path: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/* ------------------------------------------------------------------ *
 * Collections
 * ------------------------------------------------------------------ */

export async function readCollection(
  source: ContentSource,
  def: Collection,
  name: string,
): Promise<ContentEntry[]> {
  const ordered = await applyOrder(source, name, await collectionIds(source, name));

  // Eight at a time: a disk or a Git object store answers in parallel, and a
  // limit keeps a large collection from opening every file at once.
  const read = await mapLimit(ordered, 8, (id) =>
    readEntry(source, def.fields, entryFolder(name, id)),
  );
  return entriesOf(def, ordered, read);
}

/** An entry whose files Mica cannot read: its ID, the file, and the reason. */
export interface UnreadableEntry {
  id: string;
  path: string;
  message: string;
}

/**
 * The entries of a collection that can be read, and the ones that cannot. The
 * editor's list uses it, so that one broken file does not hide the rest of a
 * collection. The build and the checks use `readCollection`, which stops.
 */
export async function readReadableCollection(
  source: ContentSource,
  def: Collection,
  name: string,
): Promise<{ entries: ContentEntry[]; unreadable: UnreadableEntry[] }> {
  const ordered = await applyOrder(source, name, await collectionIds(source, name));
  const unreadable: UnreadableEntry[] = [];

  const read = await mapLimit(ordered, 8, async (id) => {
    try {
      return await readEntry(source, def.fields, entryFolder(name, id));
    } catch (error) {
      if (!(error instanceof ContentReadError)) throw error;
      unreadable.push({ id, path: error.path, message: error.message });
      return null;
    }
  });
  return { entries: entriesOf(def, ordered, read), unreadable: unreadable.sort((a, b) => byCodeUnits(a.id, b.id)) };
}

function entriesOf(def: Collection, ordered: string[], read: Array<Record<string, unknown> | null>): ContentEntry[] {
  const entries: ContentEntry[] = [];
  ordered.forEach((id, position) => {
    const data = read[position];
    if (data) entries.push({ id, position, data: withId(def, data, id) });
  });
  return entries;
}

/**
 * A collection's manual order as its `_order.json` lists it, or null when there
 * is none. Throws `ContentReadError` for a file that is not a JSON array.
 */
export async function readOrder(source: ContentSource, name: string): Promise<unknown[] | null> {
  const path = `${name}/${ORDER_FILE}`;
  const raw = await source.read(path);
  if (raw === null) return null;

  let listed: unknown;
  try {
    listed = JSON.parse(raw);
  } catch (error) {
    throw new ContentReadError(`${path} is not valid JSON.`, path, { cause: error });
  }
  if (!Array.isArray(listed)) throw new ContentReadError(`${path} must be an array of IDs.`, path);
  return listed;
}

/**
 * `fn` over `items`, at most `limit` at a time, with the results in order.
 * After a failure no new item starts, and the error of the first failing item
 * in list order is thrown, so the same broken entry is named every time.
 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors = new Map<number, unknown>();
  let next = 0;
  const worker = async () => {
    while (next < items.length && errors.size === 0) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!);
      } catch (error) {
        errors.set(index, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (errors.size > 0) throw errors.get(Math.min(...errors.keys()));
  return results;
}

/** The entry's ID is its folder name: the ID field says the same, whatever the file holds. */
function withId(def: Collection, data: Record<string, unknown>, id: string): Record<string, unknown> {
  const key = resolveIdField(def);
  return key ? { ...data, [key]: id } : data;
}

/**
 * One entry of a collection, or null when the source has no such entry.
 *
 * Reading a single document matters where the neighbours must not: comparing
 * a pending change against the repository has to work even when an unrelated
 * entry in the same collection is malformed.
 */
export async function readCollectionEntry(
  source: ContentSource,
  def: Collection,
  name: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const data = await readEntry(source, def.fields, entryFolder(name, id));
  return data && withId(def, data, id);
}

/**
 * The IDs of a collection: its folders, from one listing, without reading
 * any entry. A folder without an `index.json` (an upload for an entry that is
 * not saved yet, or one that a discard left empty) is listed too: check the
 * data file before counting it. Files, such as the order file or a README, are
 * skipped, because a content repository belongs to its owner and may hold
 * things Mica did not put there.
 */
export async function collectionIds(source: ContentSource, name: string): Promise<string[]> {
  return (await source.list(name))
    .filter((item) => item.type === "directory" && isValidId(item.name))
    .map((item) => item.name)
    .sort(byCodeUnits);
}

/**
 * The order of IDs without `_order.json`: by UTF-16 code unit, as Git lists
 * files, the same on every machine and in every source.
 */
export function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reorders IDs to match `_order.json`.
 *
 * Tolerant in both directions: an ID the file does not mention goes after the
 * ones it does, and an ID the file mentions but which no longer exists is
 * dropped. Either happens routinely when someone adds or deletes an entry in
 * Git without touching the order file.
 */
async function applyOrder(
  source: ContentSource,
  name: string,
  ids: string[],
): Promise<string[]> {
  const listed = await readOrder(source, name);
  if (listed === null) return ids;

  const available = new Set(ids);
  const ordered = listed.filter(
    (id): id is string => typeof id === "string" && available.delete(id),
  );

  // Whatever the order file did not mention keeps its place in code-unit order.
  return [...ordered, ...ids.filter((id) => available.has(id))];
}

/* ------------------------------------------------------------------ *
 * Singletons
 * ------------------------------------------------------------------ */

/**
 * A singleton's payload, or null when the repository has no file for it yet.
 *
 * Null rather than an error: a site is normally deployed before every settings
 * form has been filled in, and the collection schema is a better place to
 * report a missing required value than the reader is.
 */
export async function readSingleton(
  source: ContentSource,
  def: Singleton,
  name: string,
): Promise<Record<string, unknown> | null> {
  return readEntry(source, def.fields, entryFolder(name));
}

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

/** An entry's data from its folder, or null when the folder has no `index.json`. */
async function readEntry(source: ContentSource, fields: FieldMap, folder: string): Promise<Record<string, unknown> | null> {
  const dataPath = `${folder}/${INDEX_FILE}`;
  const data = await source.read(dataPath);
  if (data === null) return null;

  const documents = await readDocuments(source, folder);

  let parsed: Record<string, unknown>;
  try {
    parsed = parseEntry(fields, { data, documents });
  } catch (error) {
    // A `FormatError` names the problem but not the file, and a build that
    // says only "Content is not valid JSON" is close to useless.
    if (error instanceof FormatError) {
      throw new ContentReadError(`${dataPath}: ${error.message}`, dataPath, { cause: error });
    }
    throw error;
  }

  return resolveMedia(fields, parsed, folder);
}

/**
 * Applies `mapOne` to every media path in a payload, nested fields included;
 * `{ path, alt }` keeps its alt text.
 *
 * The two directions below have to agree about *which* values are media, so
 * they share one traversal rather than each keeping their own copy of the rules.
 */
export function mapMedia(
  fields: FieldMap,
  data: Record<string, unknown>,
  mapOne: (value: unknown) => unknown,
): Record<string, unknown> {
  // `media({ alt })` stores `{ path, alt }`: only the path is a path.
  const item = (one: unknown): unknown =>
    isRecord(one) && typeof one["path"] === "string" ? { ...one, path: mapOne(one["path"]) } : mapOne(one);
  return mapFields(fields, data, (field, value) =>
    field.kind !== "media" ? value : Array.isArray(value) ? value.map(item) : item(value),
  );
}

/**
 * Rewrites media references to paths relative to the content root.
 *
 * On disk a reference is written the way a person reading the entry would
 * write it: `media/exterior.jpg` for a file colocated with the entry, or
 * `/shared/logo.svg` for one the whole site uses. Both are ambiguous once the
 * entry is out of its directory, so the root-relative form is what leaves here.
 */
export function resolveMedia(
  fields: FieldMap,
  data: Record<string, unknown>,
  base: string,
): Record<string, unknown> {
  return mapMedia(fields, data, (value) =>
    typeof value === "string" && value !== ""
      ? value.startsWith("/")
        ? value.slice(1)
        : `${base}/${value}`
      : value,
  );
}

/**
 * The inverse of `resolveMedia`: root-relative back to the on-disk form.
 *
 * Every save has to do this, or the root-relative path the editor was handed
 * is written back verbatim and the entry's own directory ends up named twice
 * — once by the stored path and once by `resolveMedia` on the next read. That
 * compounds with each save, and the reference stops resolving immediately.
 *
 * A file inside the entry's directory goes back to the colocated form; one
 * anywhere else keeps the leading slash that says "from the content root".
 */
export function relativizeMedia(
  fields: FieldMap,
  data: Record<string, unknown>,
  base: string,
): Record<string, unknown> {
  const prefix = `${base}/`;

  return mapMedia(fields, data, (value) =>
    typeof value === "string" && value !== ""
      ? value.startsWith(prefix)
        ? value.slice(prefix.length)
        : `/${value}`
      : value,
  );
}

async function readDocuments(
  source: ContentSource,
  base: string,
): Promise<Record<string, string>> {
  const documents: Record<string, string> = {};

  for (const item of await source.list(base)) {
    if (item.type !== "file" || !item.name.endsWith(DOCUMENT_EXTENSION)) continue;

    const contents = await source.read(`${base}/${item.name}`);
    if (contents !== null) documents[item.name] = contents;
  }

  return documents;
}

/* ------------------------------------------------------------------ *
 * References
 * ------------------------------------------------------------------ */

/**
 * Finds the relations and media paths of a document that point at nothing in
 * `source`. Caches what it reads, so one check per build or per publication
 * reads each target once. `knownIds` gives the IDs of a collection that the
 * caller has already read.
 */
export function createReferenceCheck(
  site: Site,
  source: ContentSource,
  knownIds: (collection: string) => ReadonlySet<string> | undefined = () => undefined,
) {
  const entries = new Map<string, Promise<boolean>>();
  const directories = new Map<string, Promise<Set<string>>>();

  const entryExists = (collection: string, id: string): Promise<boolean> => {
    const known = knownIds(collection);
    if (known) return Promise.resolve(known.has(id));
    const key = `${collection}/${id}`;
    if (!entries.has(key)) {
      // The data file is enough: an entry exists when it does.
      entries.set(key, source.read(entryDataPath(collection, id)).then((data) => data !== null, () => false));
    }
    return entries.get(key)!;
  };

  /** The ids of a reference set's index; null when the index is missing or broken. */
  const referenceIds = new Map<string, Promise<Set<string> | null>>();
  const idsOf = (name: string): Promise<Set<string> | null> => {
    if (!referenceIds.has(name)) {
      referenceIds.set(name, readReferenceIndex(source, name).then((items) => (items ? new Set(items.map((item) => item.id)) : null), () => null));
    }
    return referenceIds.get(name)!;
  };

  const fileExists = async (path: string): Promise<boolean> => {
    const slash = path.lastIndexOf("/");
    const directory = slash === -1 ? "" : path.slice(0, slash);
    if (!directories.has(directory)) {
      const names = source.list(directory).then((items) => new Set(items.map((item) => item.name)), () => new Set<string>());
      directories.set(directory, names);
    }
    return (await directories.get(directory)!).has(path.slice(slash + 1));
  };

  /** A missing `/path` image is no problem: it can be a file of the website, such as one in Astro's `public/` folder. */
  const imageIssue = async (link: Extract<DocumentLink, { kind: "image" }>): Promise<FieldIssue | null> => {
    if (link.path === null) return { path: link.field, message: `The image "${link.target}" is outside the content root.` };
    if ((await fileExists(link.path)) || link.target.startsWith("/")) return null;
    return { path: link.field, message: `The image "${link.target}" does not exist.` };
  };

  const relationIssue = async (link: Extract<DocumentLink, { kind: "relation" }>): Promise<FieldIssue | null> => {
    const target = site.collections[link.collection];
    const set = site.references?.[link.collection];
    if (target && !(await entryExists(link.collection, link.id))) {
      return { path: link.field, message: `Links to "${link.id}" in ${target.label}, which does not exist.` };
    }
    if (!set) return null;
    const ids = await idsOf(set.name);
    if (!ids) return { path: link.field, message: `${set.label} has no index in ${referenceIndexPath(set.name)}. Build the website, and commit the file.` };
    return ids.has(link.id) ? null : { path: link.field, message: `Links to "${link.id}" in ${set.label}, which does not exist.` };
  };

  return {
    /** The images of the document's rich text, read from `folder`: those whose file exists, and the problems. */
    async richTextImages(fields: FieldMap, data: Record<string, unknown>, folder: string) {
      const found: Array<{ target: string; path: string }> = [];
      const issues: FieldIssue[] = [];
      for (const link of documentLinks(fields, data, folder)) {
        if (link.kind !== "image") continue;
        const issue = await imageIssue(link);
        if (issue) issues.push(issue);
        else if (link.path !== null && (await fileExists(link.path))) found.push({ target: link.target, path: link.path });
      }
      return { found, issues };
    },

    /**
     * One issue for each broken relation and missing file, at the field's path.
     * With `folder`, the folder of the document, also each missing image in rich text.
     * A link in rich text is not checked: `/about` can be a page of the website.
     */
    async issues(fields: FieldMap, data: Record<string, unknown>, folder?: string): Promise<FieldIssue[]> {
      const links = documentLinks(fields, data, folder ?? "");
      const issues: FieldIssue[] = [];
      if (folder !== undefined) {
        for (const link of links) {
          const issue = link.kind === "image" ? await imageIssue(link) : null;
          if (issue) issues.push(issue);
        }
      }
      for (const link of links) {
        if (link.kind === "relation") {
          const issue = await relationIssue(link);
          if (issue) issues.push(issue);
        } else if (link.kind === "media" && !(await fileExists(link.path))) {
          issues.push({ path: link.field, message: `The file "${link.path}" does not exist.` });
        }
      }
      return issues;
    },
  };
}

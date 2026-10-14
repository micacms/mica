/**
 * Entry discovery.
 *
 * Turns a content directory into payloads, using the layout rules `layout.ts`
 * defines. Nothing here decides where a file belongs, so a directory written by
 * the editor and a directory written by hand are read the same way — and the
 * Astro build and the Mica server read them identically, because they run this
 * same code over different sources.
 */

import { collectReferences, resolveSlugField } from "./define.js";
import { DOCUMENT_EXTENSION, FormatError, INDEX_FILE, entryDataPath, entryFolder } from "./layout.js";
import { isValidSlug } from "./slugify.js";
import { parseEntry } from "./parse.js";
import { isWebAddress, markdocImages, resolveMarkdocTarget, richTextDocuments } from "./rich-text.js";
import type { Collection, FieldMap, Singleton, Site } from "./types.js";
import type { FieldIssue } from "./validation.js";
import type { ContentSource } from "./source.js";

/**
 * Optional manual ordering for a collection, listing slugs in the order an
 * editor arranged them.
 *
 * A separate file rather than a field on each entry, because order is a
 * property of the collection: writing it into the entries would make a single
 * drag rewrite every one of them, and the resulting Git diff would say nothing
 * about what changed.
 */
export const ORDER_FILE = "_order.json";

export interface ContentEntry {
  slug: string;
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
  const slugs = await collectionSlugs(source, name);
  const ordered = await applyOrder(source, name, slugs);

  // Eight at a time: a disk or a Git object store answers in parallel, and a
  // limit keeps a large collection from opening every file at once.
  const read = await mapLimit(ordered, 8, (slug) =>
    readEntry(source, def.fields, entryFolder(name, slug)),
  );
  const entries: ContentEntry[] = [];
  ordered.forEach((slug, position) => {
    const data = read[position];
    if (data) entries.push({ slug, position, data: withSlug(def, data, slug) });
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
  if (!Array.isArray(listed)) throw new ContentReadError(`${path} must be an array of slugs.`, path);
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

/** The entry's URL is its file name: the slug field says the same, whatever the file holds. */
function withSlug(def: Collection, data: Record<string, unknown>, slug: string): Record<string, unknown> {
  const key = resolveSlugField(def);
  return key ? { ...data, [key]: slug } : data;
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
  slug: string,
): Promise<Record<string, unknown> | null> {
  const data = await readEntry(source, def.fields, entryFolder(name, slug));
  return data && withSlug(def, data, slug);
}

/**
 * The slugs of a collection: its folders, from one listing, without reading
 * any entry. A folder without an `index.json` (an upload for an entry that is
 * not saved yet, or one that a discard left empty) is listed too: check the
 * data file before counting it. Files, such as the order file or a README, are
 * skipped, because a content repository belongs to its owner and may hold
 * things Mica did not put there.
 */
export async function collectionSlugs(source: ContentSource, name: string): Promise<string[]> {
  return (await source.list(name))
    .filter((item) => item.type === "directory" && isValidSlug(item.name))
    .map((item) => item.name)
    .sort(byCodeUnits);
}

/**
 * The order of slugs without `_order.json`: by UTF-16 code unit, as Git lists
 * files, the same on every machine and in every source.
 */
export function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Reorders slugs to match `_order.json`.
 *
 * Tolerant in both directions: a slug the file does not mention goes after the
 * ones it does, and a slug the file mentions but which no longer exists is
 * dropped. Either happens routinely when someone adds or deletes an entry in
 * Git without touching the order file.
 */
async function applyOrder(
  source: ContentSource,
  name: string,
  slugs: string[],
): Promise<string[]> {
  const listed = await readOrder(source, name);
  if (listed === null) return slugs;

  const available = new Set(slugs);
  const ordered = listed.filter(
    (slug): slug is string => typeof slug === "string" && available.delete(slug),
  );

  // Whatever the order file did not mention keeps its place in code-unit order.
  return [...ordered, ...slugs.filter((slug) => available.has(slug))];
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
  const visit = (map: FieldMap, record: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...record };

    for (const [key, field] of Object.entries(map)) {
      const value = record[key];

      if (field.kind === "media") {
        // `media({ alt })` stores `{ path, alt }`: only the path is a path.
        const item = (one: unknown): unknown =>
          isRecord(one) && typeof one["path"] === "string" ? { ...one, path: mapOne(one["path"]) } : mapOne(one);
        result[key] = Array.isArray(value) ? value.map(item) : item(value);
      } else if (field.kind === "object" && isRecord(value)) {
        result[key] = visit(field.fields, value);
      } else if (field.kind === "repeater" && Array.isArray(value)) {
        result[key] = value.map((row) => (isRecord(row) ? visit(field.fields, row) : row));
      }
    }

    return result;
  };

  return visit(fields, data);
}

/**
 * Rewrites media references to paths relative to the content root.
 *
 * On disk a reference is written the way a person reading the entry would
 * write it: `media/exterior.jpg` for a file colocated with the entry, or
 * `/shared/logo.svg` for one the whole site uses. Both are ambiguous once the
 * entry is out of its directory, so the root-relative form is what leaves here.
 */
function resolveMedia(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
 * reads each target once. `knownSlugs` gives the slugs of a collection that the
 * caller has already read.
 */
export function createReferenceCheck(
  site: Site,
  source: ContentSource,
  knownSlugs: (collection: string) => ReadonlySet<string> | undefined = () => undefined,
) {
  const entries = new Map<string, Promise<boolean>>();
  const directories = new Map<string, Promise<Set<string>>>();

  const entryExists = (collection: string, slug: string): Promise<boolean> => {
    const known = knownSlugs(collection);
    if (known) return Promise.resolve(known.has(slug));
    const key = `${collection}/${slug}`;
    if (!entries.has(key)) {
      // The data file is enough: an entry exists when it does.
      entries.set(key, source.read(entryDataPath(collection, slug)).then((data) => data !== null, () => false));
    }
    return entries.get(key)!;
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

  /**
   * The images of the document's rich text, read from `folder`: those whose
   * file exists, and the problems. A missing `/path` is no problem, because it
   * can be a file of the website, such as one in Astro's `public/` folder.
   */
  const richTextImages = async (fields: FieldMap, data: Record<string, unknown>, folder: string) => {
    const found: Array<{ target: string; path: string }> = [];
    const issues: FieldIssue[] = [];
    for (const { field, text } of richTextDocuments(fields, data)) {
      for (const target of markdocImages(text)) {
        if (isWebAddress(target)) continue;
        const path = resolveMarkdocTarget(target, folder);
        if (path === null) issues.push({ path: field, message: `The image "${target}" is outside the content root.` });
        else if (await fileExists(path)) found.push({ target, path });
        else if (!target.startsWith("/")) issues.push({ path: field, message: `The image "${target}" does not exist.` });
      }
    }
    return { found, issues };
  };

  return {
    richTextImages,

    /**
     * One issue for each broken relation and missing file, at the field's path.
     * With `folder`, the folder of the document, also each missing image in rich text.
     */
    async issues(fields: FieldMap, data: Record<string, unknown>, folder?: string): Promise<FieldIssue[]> {
      const issues: FieldIssue[] = folder === undefined ? [] : (await richTextImages(fields, data, folder)).issues;
      for (const reference of collectReferences(fields, data)) {
        if (reference.kind === "relation") {
          const target = site.collections[reference.collection];
          if (target && !(await entryExists(reference.collection, reference.slug))) {
            issues.push({ path: reference.field, message: `Links to "${reference.slug}" in ${target.label}, which does not exist.` });
          }
        } else if (!(await fileExists(reference.path))) {
          issues.push({ path: reference.field, message: `The file "${reference.path}" does not exist.` });
        }
      }
      return issues;
    },
  };
}

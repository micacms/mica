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
import { DOCUMENT_EXTENSION, FormatError, INDEX_FILE, entryLayout, type EntryLayout } from "./layout.js";
import { isValidSlug } from "./slugify.js";
import { parseEntry } from "./parse.js";
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

/**
 * Entries stored in the layout that the fields do not give. A model change
 * moved them, and the files did not follow: reading on would hide them.
 */
export class LayoutError extends ContentReadError {
  override name = "LayoutError";
  constructor(
    readonly paths: string[],
    name: string,
    layout: EntryLayout,
  ) {
    const shown = paths.length > 5 ? [...paths.slice(0, 5), `and ${paths.length - 5} more`] : paths;
    super(
      `"${name}" is stored as ${layout === "directory" ? "folders with index.json" : ".json files"}, ` +
        `but these files are in the other layout: ${shown.join(", ")}. ` +
        "Run `npx mica migrate-layout`, check the result, and commit it.",
      paths[0]!,
    );
  }
}

/**
 * The files of a collection or singleton that are in the other layout, for a
 * check before anything reads them, and for `mica migrate-layout`.
 */
export async function misplacedFiles(
  source: ContentSource,
  fields: FieldMap,
  name: string,
  kind: "collection" | "singleton",
): Promise<string[]> {
  if (kind === "collection") return (await scanCollection(source, fields, name)).misplaced;
  const other = entryLayout(fields) === "directory" ? `${name}.json` : `${name}/${INDEX_FILE}`;
  return (await source.read(other)) === null ? [] : [other];
}

/* ------------------------------------------------------------------ *
 * Collections
 * ------------------------------------------------------------------ */

export async function readCollection(
  source: ContentSource,
  def: Collection,
  name: string,
): Promise<ContentEntry[]> {
  const slugs = await listSlugs(source, def.fields, name);
  const ordered = await applyOrder(source, name, slugs);

  const entries: ContentEntry[] = [];

  for (const [position, slug] of ordered.entries()) {
    const data = await readEntry(source, def.fields, `${name}/${slug}`, entryBase(def.fields, name, slug));
    if (data) entries.push({ slug, position, data: withSlug(def, data, slug) });
  }

  return entries;
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
  const data = await readEntry(source, def.fields, `${name}/${slug}`, entryBase(def.fields, name, slug));
  return data && withSlug(def, data, slug);
}

/**
 * Slugs present in a collection directory.
 *
 * The layout decides what to look at: directory-shaped entries are directories,
 * file-shaped ones are `.json` files. An entry in the other layout is an error,
 * because skipping it would hide a page. Anything else — a stray README, the
 * order file, a directory without an `index.json` — is skipped, because a
 * content repository belongs to its owner and may hold things Mica did not put
 * there.
 */
async function listSlugs(
  source: ContentSource,
  fields: FieldMap,
  name: string,
): Promise<string[]> {
  const { slugs, misplaced } = await scanCollection(source, fields, name);
  if (misplaced.length > 0) throw new LayoutError(misplaced, name, entryLayout(fields));
  return slugs;
}

/** The slugs in the collection's layout, and the entries in the other one. */
async function scanCollection(
  source: ContentSource,
  fields: FieldMap,
  name: string,
): Promise<{ slugs: string[]; misplaced: string[] }> {
  const directoryLayout = entryLayout(fields) === "directory";
  const slugs: string[] = [];
  const misplaced: string[] = [];

  for (const item of await source.list(name)) {
    const jsonSlug = item.type === "file" && item.name.endsWith(".json") ? item.name.slice(0, -".json".length) : null;

    if (directoryLayout) {
      if (item.type === "directory" && isValidSlug(item.name)) slugs.push(item.name);
      else if (jsonSlug !== null && item.name !== ORDER_FILE && isValidSlug(jsonSlug)) misplaced.push(`${name}/${item.name}`);
      continue;
    }

    if (jsonSlug !== null && isValidSlug(jsonSlug)) slugs.push(jsonSlug);
    else if (item.type === "directory" && isValidSlug(item.name)) {
      const index = `${name}/${item.name}/${INDEX_FILE}`;
      if ((await source.read(index)) !== null) misplaced.push(index);
    }
  }

  return { slugs, misplaced };
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
  const path = `${name}/${ORDER_FILE}`;
  const raw = await source.read(path);
  if (raw === null) return slugs;

  let listed: unknown;
  try {
    listed = JSON.parse(raw);
  } catch (error) {
    throw new ContentReadError(`${path} is not valid JSON.`, path, { cause: error });
  }

  if (!Array.isArray(listed)) {
    throw new ContentReadError(`${path} must be an array of slugs.`, path);
  }

  const available = new Set(slugs);
  const ordered = listed.filter(
    (slug): slug is string => typeof slug === "string" && available.delete(slug),
  );

  // Whatever the order file did not mention keeps its alphabetical position.
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
  const data = await readEntry(source, def.fields, name, entryBase(def.fields, name));
  if (data !== null) return data;
  const misplaced = await misplacedFiles(source, def.fields, name, "singleton");
  if (misplaced.length > 0) throw new LayoutError(misplaced, name, entryLayout(def.fields));
  return null;
}

/* ------------------------------------------------------------------ *
 * Shared
 * ------------------------------------------------------------------ */

/** The directory an entry's files live in, or null for file-shaped entries. */
function entryBase(fields: FieldMap, ...segments: string[]): string | null {
  return entryLayout(fields) === "directory" ? segments.join("/") : null;
}

async function readEntry(
  source: ContentSource,
  fields: FieldMap,
  label: string,
  base: string | null,
): Promise<Record<string, unknown> | null> {
  const dataPath = base === null ? `${label}.json` : `${base}/${INDEX_FILE}`;

  const data = await source.read(dataPath);
  if (data === null) return null;

  const documents = base === null ? {} : await readDocuments(source, base);

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

  return base === null ? parsed : resolveMedia(fields, parsed, base);
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
      const { fields } = site.collections[collection]!;
      const base = `${collection}/${slug}`;
      const dataPath = entryLayout(fields) === "directory" ? `${base}/${INDEX_FILE}` : `${base}.json`;
      entries.set(key, source.read(dataPath).then((data) => data !== null, () => false));
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

  return {
    /** One issue for each broken relation and missing file, at the field's path. */
    async issues(fields: FieldMap, data: Record<string, unknown>): Promise<FieldIssue[]> {
      const issues: FieldIssue[] = [];
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

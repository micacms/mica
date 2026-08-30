/**
 * Entry discovery.
 *
 * Turns a content directory into payloads, using the layout rules `layout.ts`
 * defines. Nothing here decides where a file belongs, so a directory written by
 * the editor and a directory written by hand are read the same way — and the
 * Astro build and the Mica server read them identically, because they run this
 * same code over different sources.
 */

import { DOCUMENT_EXTENSION, FormatError, INDEX_FILE, entryLayout } from "./layout.js";
import { isValidSlug } from "./slugify.js";
import { parseEntry } from "./parse.js";
import type { Collection, FieldMap, Singleton } from "./types.js";
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
  const slugs = await listSlugs(source, def.fields, name);
  const ordered = await applyOrder(source, name, slugs);

  const entries: ContentEntry[] = [];

  for (const [position, slug] of ordered.entries()) {
    const data = await readEntry(source, def.fields, `${name}/${slug}`, entryBase(def.fields, name, slug));
    if (data) entries.push({ slug, position, data });
  }

  return entries;
}

/**
 * Slugs present in a collection directory.
 *
 * The layout decides what to look at: directory-shaped entries are directories,
 * file-shaped ones are `.json` files. Anything that does not match — a stray
 * README, the order file, a directory without an `index.json` — is skipped
 * rather than rejected, because a content repository belongs to its owner and
 * may hold things Mica did not put there.
 */
async function listSlugs(
  source: ContentSource,
  fields: FieldMap,
  name: string,
): Promise<string[]> {
  const directoryLayout = entryLayout(fields) === "directory";
  const items = await source.list(name);
  const slugs: string[] = [];

  for (const item of items) {
    if (directoryLayout) {
      if (item.type !== "directory") continue;
      if (isValidSlug(item.name)) slugs.push(item.name);
      continue;
    }

    if (item.type !== "file" || !item.name.endsWith(".json")) continue;
    const slug = item.name.slice(0, -".json".length);
    if (isValidSlug(slug)) slugs.push(slug);
  }

  return slugs;
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
  return readEntry(source, def.fields, name, entryBase(def.fields, name));
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
 * Walks every media field in an entry, replacing each path with `mapOne`.
 *
 * The two directions below have to agree about *which* values are media —
 * including the ones nested in objects and repeaters — so they share one
 * traversal rather than each keeping their own copy of the rules.
 */
function mapMedia(
  fields: FieldMap,
  data: Record<string, unknown>,
  mapOne: (value: unknown) => unknown,
): Record<string, unknown> {
  const visit = (map: FieldMap, record: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...record };

    for (const [key, field] of Object.entries(map)) {
      const value = record[key];

      if (field.kind === "media") {
        result[key] = Array.isArray(value) ? value.map(mapOne) : mapOne(value);
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

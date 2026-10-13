/**
 * How a collection entry or a singleton is laid out in the repository.
 *
 * The layout is *derived from the model*, never declared. A content directory
 * is therefore reproducible: given the same model, two Mica versions agree on
 * where every file belongs, and a human reading the repository can predict the
 * path of anything without consulting the CMS.
 *
 *   projects/                       collection, directory layout
 *   └── buchholzstrasse/
 *       ├── index.json              structured fields
 *       ├── description.mdoc        one rich-text field
 *       └── media/                  colocated media
 *           └── exterior.jpg
 *
 *   team/                           collection, file layout
 *   └── anna-vogt.json
 *
 *   site.json                       singleton, file layout
 */

import type { FieldMap } from "./types.js";

export class FormatError extends Error {
  override name = "FormatError";
}

/** File name holding the structured fields of a directory-shaped entry. */
export const INDEX_FILE = "index.json";

/** Directory holding media colocated with a directory-shaped entry. */
export const MEDIA_DIR = "media";

/** Extension of a rich-text sidecar. */
export const DOCUMENT_EXTENSION = ".mdoc";

/**
 * `directory` when the entry owns more than one file, `file` when a single
 * JSON document says everything there is to say about it.
 */
export type EntryLayout = "file" | "directory";

/** Layouts that a manifest recorded, for field maps read back from it. */
const recorded = new WeakMap<FieldMap, EntryLayout>();

/**
 * Makes `entryLayout(fields)` return the layout the manifest recorded. A reader
 * calls it, so that a field kind it does not know cannot change where it
 * looks for the entries.
 */
export function recordLayout(fields: FieldMap, layout: EntryLayout): void {
  recorded.set(fields, layout);
}

/** The recorded layout of these fields, or the one they imply. */
export function entryLayout(fields: FieldMap): EntryLayout {
  return recorded.get(fields) ?? deriveLayout(fields);
}

/**
 * A model needs a directory when it can produce sidecar files: rich text is
 * written to `.mdoc`, and media is colocated under `media/`. Anything else
 * fits in one JSON document, which keeps small singletons and flat collections
 * — a team list, a set of links — readable as a single file.
 */
export function deriveLayout(fields: FieldMap): EntryLayout {
  return needsSidecars(fields) ? "directory" : "file";
}

function needsSidecars(fields: FieldMap): boolean {
  for (const field of Object.values(fields)) {
    if (field.kind === "richText" || field.kind === "media") return true;
    if (field.kind === "object" || field.kind === "repeater") {
      if (needsSidecars(field.fields)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

/** A path segment: a field key, or a repeater row index. */
export type PathSegment = string | number;

/**
 * The sidecar file name for one rich-text field.
 *
 * Dotted rather than nested, so every file of an entry sits directly beside its
 * `index.json`: `body.mdoc`, `sections.0.body.mdoc`. Field keys are validated as
 * lowerCamelCase by `defineSite`, so a segment can never introduce a separator
 * or escape the entry directory.
 */
export function documentName(path: readonly PathSegment[]): string {
  if (path.length === 0) throw new FormatError("A rich-text field must have a path.");
  return `${path.join(".")}${DOCUMENT_EXTENSION}`;
}

/** The reverse of `documentName`, for reading a directory back. */
export function documentPath(name: string): PathSegment[] {
  if (!name.endsWith(DOCUMENT_EXTENSION)) {
    throw new FormatError(`"${name}" is not a rich-text document.`);
  }
  return name
    .slice(0, -DOCUMENT_EXTENSION.length)
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/**
 * Where one entry of a collection lives, relative to the content root.
 *
 * `file` layout yields a path to the JSON document itself; `directory` layout
 * yields the directory, whose structured fields are in `index.json`.
 */
export function collectionEntryPath(fields: FieldMap, collection: string, slug: string): string {
  return entryLayout(fields) === "directory"
    ? `${collection}/${slug}`
    : `${collection}/${slug}.json`;
}

/** Where one singleton lives, relative to the content root. */
export function singletonPath(fields: FieldMap, name: string): string {
  return entryLayout(fields) === "directory" ? name : `${name}.json`;
}

/**
 * Every file of an entry, keyed by path relative to the content root.
 *
 * `base` is a `collectionEntryPath` or a `singletonPath`. Media is not included:
 * it is written and moved by the media pipeline, not by the serializer, which
 * only records the paths that reference it.
 */
export function entryFiles(
  fields: FieldMap,
  base: string,
  serialized: { data: string; documents: Record<string, string> },
): Record<string, string> {
  const files: Record<string, string> = {};

  if (entryLayout(fields) === "file") {
    files[base] = serialized.data;
    // A file-shaped entry has no sidecars by construction; if one appears, the
    // layout rule and the serializer have drifted apart.
    const stray = Object.keys(serialized.documents)[0];
    if (stray) {
      throw new FormatError(
        `Entry "${base}" has file layout but produced the sidecar "${stray}".`,
      );
    }
    return files;
  }

  files[`${base}/${INDEX_FILE}`] = serialized.data;
  for (const [name, contents] of Object.entries(serialized.documents)) {
    files[`${base}/${name}`] = contents;
  }
  return files;
}

/**
 * How a collection entry or a singleton is laid out in the repository: a
 * folder with `index.json`, its rich text and its media.
 *
 *   projects/                       collection
 *   └── buchholzstrasse/            entry
 *       ├── index.json              structured fields
 *       ├── description.mdoc        one rich-text field
 *       └── media/                  colocated media
 *           └── exterior.jpg
 *
 *   site/                           singleton
 *   └── index.json
 *
 *   media/                          shared media
 */

import type { FieldMap } from "./types.js";

export class FormatError extends Error {
  override name = "FormatError";
}

/** File name holding the structured fields of an entry. */
export const INDEX_FILE = "index.json";

/** Directory holding media colocated with an entry, and the shared media folder at the content root. */
export const MEDIA_DIR = "media";

/** Extension of a rich-text sidecar. */
export const DOCUMENT_EXTENSION = ".mdoc";

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

/** A path segment: a field key, a repeater row's key, or a row's index in the data. */
export type PathSegment = string | number;

/**
 * The sidecar file name for one rich-text field.
 *
 * Dotted rather than nested, so every file of an entry sits directly beside its
 * `index.json`: `body.mdoc`, `sections.k3f9a2.body.mdoc`. Field keys are validated as
 * lowerCamelCase by `defineSite`, so a segment can never introduce a separator
 * or escape the entry directory.
 */
export function documentName(path: readonly PathSegment[]): string {
  if (path.length === 0) throw new FormatError("A rich-text field must have a path.");
  return `${path.join(".")}${DOCUMENT_EXTENSION}`;
}

/** The reverse of `documentName`, for reading a directory back. */
export function documentPath(name: string): string[] {
  if (!name.endsWith(DOCUMENT_EXTENSION)) {
    throw new FormatError(`"${name}" is not a rich-text document.`);
  }
  return name.slice(0, -DOCUMENT_EXTENSION.length).split(".");
}

/**
 * Whether the model declares a sidecar's path: it leads, through objects and
 * repeater rows, to a rich-text field. A save deletes such a file when the field
 * is empty or its row is gone, and keeps any other `.mdoc` file (#217).
 */
export function declaresDocument(fields: FieldMap, path: readonly string[]): boolean {
  const [head = "", ...rest] = path;
  const field = fields[head];
  if (!field) return false;
  if (rest.length === 0) return field.kind === "richText";
  if (field.kind === "object") return declaresDocument(field.fields, rest);
  if (field.kind === "repeater") return rest.length > 1 && declaresDocument(field.fields, rest.slice(1));
  return false;
}

/** The folder of a collection entry, or of a singleton without `slug`: `team/anna-vogt`, `site`. */
export function entryFolder(name: string, slug?: string): string {
  return slug === undefined ? name : `${name}/${slug}`;
}

/** The file with the structured fields of a collection entry or a singleton. */
export function entryDataPath(name: string, slug?: string): string {
  return `${entryFolder(name, slug)}/${INDEX_FILE}`;
}

/**
 * Every file of an entry, keyed by path relative to the content root. Media is
 * not included: it is written and moved by the media pipeline, not by the
 * serializer, which only records the paths that reference it.
 */
export function entryFiles(
  folder: string,
  serialized: { data: string; documents: Record<string, string> },
): Record<string, string> {
  const files: Record<string, string> = { [`${folder}/${INDEX_FILE}`]: serialized.data };
  for (const [name, contents] of Object.entries(serialized.documents)) files[`${folder}/${name}`] = contents;
  return files;
}

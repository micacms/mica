/**
 * Entry payload → repository files.
 *
 * Two rules carry the whole format:
 *
 *   1. Structured fields go to JSON, in *model order* rather than in whatever
 *      order the payload happens to have. Serialising the same content twice
 *      produces byte-identical output, so a Git diff shows editorial change
 *      and nothing else. One exception: a repeater row with rich text and no
 *      key gets a new key each time, until the key is stored.
 *   2. A rich-text field goes to its own `.mdoc` sidecar and is *absent* from
 *      the JSON. There is no pointer to reconcile: the model already says which
 *      fields are rich text, and `documentName` says where each one lives. A
 *      missing sidecar means the field is empty. In a repeater, the row's key
 *      names the file (`row-key.ts`), so a reorder renames nothing.
 */

import { documentName, type PathSegment } from "./layout.js";
import { needsRowKey, ROW_KEY, rowKeys } from "./row-key.js";
import type { AnyField, FieldMap } from "./types.js";

export interface SerializedEntry {
  /** Contents of `index.json`. */
  data: string;
  /** Rich-text sidecars, keyed by file name relative to the entry. */
  documents: Record<string, string>;
}

export function serializeEntry(
  fields: FieldMap,
  data: Record<string, unknown>,
): SerializedEntry {
  const documents: Record<string, string> = {};
  const structured = project(fields, data, [], documents);

  return { data: `${JSON.stringify(structured, null, 2)}\n`, documents };
}

/**
 * Rebuilds a payload in model order, lifting rich text out into `documents`.
 *
 * Keys the model no longer declares are dropped, matching `fieldsSchema`, which
 * strips them. Retiring a field therefore removes it from the repository at the
 * next save rather than leaving an orphan the format cannot explain.
 */
function project(
  fields: FieldMap,
  data: Record<string, unknown>,
  path: readonly PathSegment[],
  documents: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(fields)) {
    const here = [...path, key];
    const value = data[key];

    if (field.kind === "richText") {
      const text = asDocument(value);
      if (text !== null) documents[documentName(here)] = text;
      continue;
    }

    result[key] = projectValue(field, value, here, documents);
  }

  return result;
}

function projectValue(
  field: AnyField,
  value: unknown,
  path: readonly PathSegment[],
  documents: Record<string, string>,
): unknown {
  if (field.kind === "object") {
    return project(field.fields, asRecord(value), path, documents);
  }

  if (field.kind === "repeater") {
    const rows = Array.isArray(value) ? value : [];
    if (!needsRowKey(field.fields)) return rows.map((row) => project(field.fields, asRecord(row), path, documents));
    const keys = rowKeys(rows);
    return rows.map((row, index) => ({
      [ROW_KEY]: keys[index],
      ...project(field.fields, asRecord(row), [...path, keys[index]!], documents),
    }));
  }

  if (field.kind === "media" && field.alt) {
    // Fixed key order, so that the same value always gives the same bytes.
    const one = (item: unknown): unknown => {
      const record = asRecord(item);
      return typeof record["path"] === "string" ? { path: record["path"], alt: record["alt"] ?? null } : item;
    };
    return Array.isArray(value) ? value.map(one) : value == null ? null : one(value);
  }

  // Everything else is already JSON: the DSL admits no value that is not.
  return value ?? null;
}

/** Markdoc body for a rich-text value, or null when there is nothing to write. */
function asDocument(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  // A trailing newline makes the file a well-formed text file and keeps Git
  // from reporting "\ No newline at end of file" on every rich-text edit.
  return `${text}\n`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

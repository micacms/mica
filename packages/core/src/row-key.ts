/**
 * Stable keys for repeater rows (#220).
 *
 * A row whose fields hold rich text keeps its Markdoc in sidecar files beside
 * the entry. The file names carry the row's key, not its position —
 * `sections.k3f9a2.body.mdoc` — so that a reorder changes only the JSON. The key
 * is stored in the row as `_key`, a name that no field can have: field keys are
 * lowerCamelCase. Rows without rich text need no key and get none.
 *
 * Content from before the keys names its sidecars by row number
 * (`sections.0.body.mdoc`). The reader refuses those that `mica migrate-layout`
 * converts (`numberedDocuments`), and the command converts them with
 * `keyRepeaterRows`. A numbered file that no row or field reads is ignored.
 */

import { documentName, documentPath, type PathSegment } from "./layout.js";
import type { FieldMap } from "./types.js";

/** The row property that holds the key. */
export const ROW_KEY = "_key";

/** A letter, then letters and digits: never all digits, so a key cannot be read as a row number. */
const KEY_PATTERN = /^[a-z][a-z0-9]{3,15}$/;

export function isRowKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

/** Whether the rows of a repeater with these fields need keys: rich text anywhere inside them. */
export function needsRowKey(fields: FieldMap): boolean {
  return Object.values(fields).some(
    (field) =>
      field.kind === "richText" ||
      ((field.kind === "object" || field.kind === "repeater") && needsRowKey(field.fields)),
  );
}

/** A new key that is not in `taken`. */
export function newRowKey(taken: ReadonlySet<string> = new Set()): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
    const key = [...bytes].map((byte, index) => alphabet[byte % (index === 0 ? 26 : 36)]).join("");
    if (!taken.has(key)) return key;
  }
}

/** The key of each row: its own when it is valid and not used by an earlier row, else a new one. */
export function rowKeys(rows: readonly unknown[]): string[] {
  const taken = new Set<string>();
  return rows.map((row) => {
    const own = isRecord(row) ? row[ROW_KEY] : undefined;
    const key = isRowKey(own) && !taken.has(own) ? own : newRowKey(new Set([...taken, ...ownKeys(rows)]));
    taken.add(key);
    return key;
  });
}

export interface KeyedRows {
  /** The stored JSON with a key in every row that needs one; everything else as it was. */
  data: Record<string, unknown>;
  /** Sidecar file names that change: old name to new name. */
  renames: Record<string, string>;
  /** Whether the JSON changed. */
  changed: boolean;
}

/**
 * Converts an entry's stored files to row keys, without touching anything else:
 * unknown keys, values and the order of keys stay. `documents` are the names of
 * the entry's sidecar files.
 */
export function keyRepeaterRows(fields: FieldMap, stored: Record<string, unknown>, documents: readonly string[]): KeyedRows {
  const data = structuredClone(stored);
  let changed = false;

  const visit = (map: FieldMap, record: Record<string, unknown>) => {
    for (const [name, field] of Object.entries(map)) {
      const value = record[name];
      if (field.kind === "object" && isRecord(value)) visit(field.fields, value);
      if (field.kind !== "repeater" || !Array.isArray(value)) continue;
      const keys = needsRowKey(field.fields) ? rowKeys(value) : null;
      value.forEach((row, index) => {
        if (!isRecord(row)) return;
        if (keys && row[ROW_KEY] !== keys[index]) {
          const rest = Object.fromEntries(Object.entries(row).filter(([key]) => key !== ROW_KEY));
          value[index] = { [ROW_KEY]: keys[index], ...rest };
          changed = true;
        }
        visit(field.fields, value[index] as Record<string, unknown>);
      });
    }
  };
  visit(fields, data);

  const renames: Record<string, string> = {};
  for (const name of documents) {
    const keyed = keyedPath(fields, data, documentPath(name));
    if (keyed && documentName(keyed) !== name) renames[name] = documentName(keyed);
  }
  return { data, renames, changed };
}

/** A sidecar path with each row number replaced by the key of that row; null when the path leads nowhere. */
function keyedPath(fields: FieldMap, data: Record<string, unknown>, path: readonly PathSegment[]): PathSegment[] | null {
  const [head, ...rest] = path;
  if (typeof head !== "string") return null;
  const field = fields[head];
  if (!field) return null;
  if (rest.length === 0) return field.kind === "richText" ? [head] : null;
  const value = data[head];

  if (field.kind === "object") {
    if (!isRecord(value)) return null;
    const tail = keyedPath(field.fields, value, rest);
    return tail && [head, ...tail];
  }
  if (field.kind === "repeater" && Array.isArray(value)) {
    const [row, ...tail] = rest;
    const record = typeof row === "number" ? value[row] : value.find((item) => isRecord(item) && item[ROW_KEY] === row);
    if (!isRecord(record) || !isRowKey(record[ROW_KEY])) return null;
    const inner = keyedPath(field.fields, record, tail);
    return inner && [head, record[ROW_KEY], ...inner];
  }
  return null;
}

/**
 * The sidecars that name a repeater row by its number and that a row and a
 * rich-text field still read: the files that `keyRepeaterRows` renames.
 */
export function numberedDocuments(fields: FieldMap, stored: Record<string, unknown>, documents: readonly string[]): string[] {
  return documents.filter((name) => {
    const path = documentPath(name);
    return path.some((segment) => typeof segment === "number") && reads(fields, stored, path);
  });
}

/** Whether a sidecar's path leads through existing rows, by key or by number, to a rich-text field. */
export function readsDocument(fields: FieldMap, stored: Record<string, unknown>, name: string): boolean {
  return reads(fields, stored, documentPath(name));
}

function reads(fields: FieldMap, data: Record<string, unknown>, path: readonly PathSegment[]): boolean {
  const [head, ...rest] = path;
  if (typeof head !== "string") return false;
  const field = fields[head];
  if (!field) return false;
  if (rest.length === 0) return field.kind === "richText";
  const value = data[head];
  if (field.kind === "object") return isRecord(value) && reads(field.fields, value, rest);
  if (field.kind !== "repeater" || !Array.isArray(value)) return false;
  const [row, ...tail] = rest;
  const record = typeof row === "number" ? value[row] : value.find((item) => isRecord(item) && item[ROW_KEY] === row);
  return isRecord(record) && reads(field.fields, record, tail);
}

function ownKeys(rows: readonly unknown[]): string[] {
  return rows.flatMap((row) => (isRecord(row) && isRowKey(row[ROW_KEY]) ? [row[ROW_KEY]] : []));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

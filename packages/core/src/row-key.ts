/**
 * Stable keys for repeater rows (#220).
 *
 * A row whose fields hold rich text keeps its Markdoc in sidecar files beside
 * the entry. The file names carry the row's key, not its position —
 * `sections.k3f9a2.body.mdoc` — so that a reorder changes only the JSON. The key
 * is stored in the row as `_key`, a name that no field can have: field keys are
 * lowerCamelCase. Rows without rich text need no key and get none.
 */

import { documentPath } from "./layout.js";
import type { FieldMap } from "./types.js";

/** The row property that holds the key. */
export const ROW_KEY = "_key";

/** A letter, then letters and digits. */
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

/** Whether a sidecar's path leads through existing rows, by their keys, to a rich-text field. */
export function readsDocument(fields: FieldMap, stored: Record<string, unknown>, name: string): boolean {
  return reads(fields, stored, documentPath(name));
}

function reads(fields: FieldMap, data: Record<string, unknown>, path: readonly string[]): boolean {
  const [head = "", ...rest] = path;
  const field = fields[head];
  if (!field) return false;
  if (rest.length === 0) return field.kind === "richText";
  const value = data[head];
  if (field.kind === "object") return isRecord(value) && reads(field.fields, value, rest);
  if (field.kind !== "repeater" || !Array.isArray(value)) return false;
  const [row, ...tail] = rest;
  const record = value.find((item) => isRecord(item) && item[ROW_KEY] === row);
  return isRecord(record) && reads(field.fields, record, tail);
}

function ownKeys(rows: readonly unknown[]): string[] {
  return rows.flatMap((row) => (isRecord(row) && isRowKey(row[ROW_KEY]) ? [row[ROW_KEY]] : []));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

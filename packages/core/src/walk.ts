/**
 * The one traversal of a document's values: every field of a field map with its
 * value, through objects and repeater rows. Links, media paths, rich text and
 * `mica check` read a document with it, so they agree on what is nested where.
 */

import type { AnyField, FieldMap } from "./types.js";
import type { PathSegment } from "./layout.js";

/** Calls `visit` for every field with its value, also an absent one; a container before its fields. `path` has a row's index. */
export function walkFields(
  fields: FieldMap,
  data: Record<string, unknown>,
  visit: (field: AnyField, value: unknown, path: PathSegment[]) => void,
  at: PathSegment[] = [],
): void {
  for (const [key, field] of Object.entries(fields)) {
    const value = data[key];
    const path = [...at, key];
    visit(field, value, path);
    if (field.kind === "object" && isRecord(value)) walkFields(field.fields, value, visit, path);
    if (field.kind === "repeater" && Array.isArray(value)) {
      value.forEach((row, index) => isRecord(row) && walkFields(field.fields, row, visit, [...path, index]));
    }
  }
}

/**
 * A copy of `data` where `map` gives the value of every field that is not an
 * object or a repeater, nested fields included. A key stays absent when `map`
 * gives back its absent value; keys that the model does not have stay as they are.
 */
export function mapFields(
  fields: FieldMap,
  data: Record<string, unknown>,
  map: (field: AnyField, value: unknown, path: PathSegment[]) => unknown,
  at: PathSegment[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  for (const [key, field] of Object.entries(fields)) {
    const value = data[key];
    const path = [...at, key];
    if (field.kind === "object") {
      if (isRecord(value)) result[key] = mapFields(field.fields, value, map, path);
    } else if (field.kind === "repeater") {
      if (Array.isArray(value)) {
        result[key] = value.map((row, index) => (isRecord(row) ? mapFields(field.fields, row, map, [...path, index]) : row));
      }
    } else {
      const next = map(field, value, path);
      if (next !== value || key in data) result[key] = next;
    }
  }
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

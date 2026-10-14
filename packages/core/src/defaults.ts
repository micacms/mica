/**
 * Empty-value construction.
 *
 * The admin SPA needs a fully-populated object before it can bind inputs — a
 * missing key would make a control uncontrolled. These helpers produce the
 * storage-shape skeleton for a field map, honouring declared defaults.
 */

import { isRowKey, ROW_KEY } from "./row-key.js";
import type { AnyField, FieldMap } from "./types.js";

export function defaultValue(field: AnyField): unknown {
  switch (field.kind) {
    case "boolean":
      return field.default ?? false;

    case "repeater":
      return [];

    case "object":
      return defaultValues(field.fields);

    case "select":
      if (field.multiple) return Array.isArray(field.default) ? field.default : [];
      return typeof field.default === "string" ? field.default : null;

    case "media":
    case "relation":
      return field.multiple ? [] : null;

    case "text":
    case "textarea":
    case "richText":
    case "email":
    case "url":
    case "color":
    case "date":
      return field.default ?? null;

    case "number":
      return field.default ?? null;

    case "slug":
    case "coordinates":
      return null;

    case "tags":
      return field.default ? [...field.default] : [];
  }
}

export function defaultValues(fields: FieldMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    result[key] = defaultValue(field);
  }
  return result;
}

/**
 * Fills keys missing from `data` with their defaults and drops keys no longer
 * present in the model. Applied when loading an entry written under an older
 * version of the schema, so form binding never sees an absent key.
 */
export function withDefaults(
  fields: FieldMap,
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const source = data ?? {};
  const result: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(fields)) {
    const value = source[key];

    if (value === undefined) {
      result[key] = defaultValue(field);
      continue;
    }

    if (field.kind === "object") {
      result[key] = withDefaults(
        field.fields,
        (value ?? {}) as Record<string, unknown>,
      );
      continue;
    }

    if (field.kind === "repeater") {
      const rows = Array.isArray(value) ? value : [];
      result[key] = rows.map((row) => {
        const record = row as Record<string, unknown>;
        const filled = withDefaults(field.fields, record);
        // The row's key names its rich-text files: it stays with the row.
        return isRowKey(record?.[ROW_KEY]) ? { [ROW_KEY]: record[ROW_KEY], ...filled } : filled;
      });
      continue;
    }

    result[key] = value;
  }

  return result;
}

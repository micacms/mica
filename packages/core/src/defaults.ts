/**
 * Empty values and defaults.
 *
 * The editor needs a fully-populated object before it can bind inputs — a
 * missing key would make a control uncontrolled. A read fills a missing value
 * with the field's empty value. A default fills a field only when an entry is
 * created (#221): a changed default never changes stored entries unseen, and a
 * cleared field stays cleared.
 */

import { isRowKey, ROW_KEY } from "./row-key.js";
import type { AnyField, FieldMap } from "./types.js";

/** The value of a field that holds nothing. */
function emptyValue(field: AnyField): unknown {
  switch (field.kind) {
    case "boolean":
      return false;
    case "repeater":
    case "tags":
      return [];
    case "object":
      return emptyValues(field.fields);
    case "select":
    case "media":
    case "relation":
      return field.multiple ? [] : null;
    default:
      return null;
  }
}

/** A new entry's value for a field: its default, or its empty value. */
function defaultValue(field: AnyField): unknown {
  switch (field.kind) {
    case "object":
      return defaultValues(field.fields);
    case "boolean":
      return field.default ?? false;
    case "select":
      if (field.multiple) return Array.isArray(field.default) ? field.default : [];
      return typeof field.default === "string" ? field.default : null;
    case "tags":
      return field.default ? [...field.default] : [];
    case "text":
    case "textarea":
    case "richText":
    case "email":
    case "url":
    case "color":
    case "date":
    case "number":
      return field.default ?? null;
    default:
      return emptyValue(field);
  }
}

/** A new entry: every field at its default. */
export function defaultValues(fields: FieldMap): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, defaultValue(field)]));
}

function emptyValues(fields: FieldMap): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, emptyValue(field)]));
}

/**
 * `data` with every field of the model: a missing value is empty, never a
 * default, and a key that the model does not declare is left out. The stored
 * file keeps such a key (`serializeEntry`).
 */
export function withEmptyValues(
  fields: FieldMap,
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const source = data ?? {};
  const result: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(fields)) {
    const value = source[key];

    if (value === undefined) {
      result[key] = emptyValue(field);
      continue;
    }

    if (field.kind === "object") {
      result[key] = withEmptyValues(field.fields, (value ?? {}) as Record<string, unknown>);
      continue;
    }

    if (field.kind === "repeater") {
      const rows = Array.isArray(value) ? value : [];
      result[key] = rows.map((row) => {
        const record = row as Record<string, unknown>;
        const filled = withEmptyValues(field.fields, record);
        // The row's key names its rich-text files: it stays with the row.
        return isRowKey(record?.[ROW_KEY]) ? { [ROW_KEY]: record[ROW_KEY], ...filled } : filled;
      });
      continue;
    }

    result[key] = value;
  }

  return result;
}

/** The label of a field at a dotted path, as the form shows it: `seo.title` → "Title". */

import type { AnyField, FieldMap } from "@micacms/core/internal";

import { humanise } from "@/composables/useField";

/** Null for a path that the model does not have. A row's index (`facts.2.label`) is skipped. */
export function fieldLabel(fields: FieldMap, path: string): string | null {
  const field = fieldAt(fields, path);
  const name = path.split(".").filter((part) => !/^\d+$/.test(part)).at(-1);
  return field && name ? (field.label ?? humanise(name)) : null;
}

/** The field at a dotted path, or null. A row's index is skipped. */
export function fieldAt(fields: FieldMap, path: string): AnyField | null {
  let current: FieldMap | undefined = fields;
  let found: AnyField | null = null;
  for (const part of path.split(".")) {
    if (/^\d+$/.test(part)) continue;
    const field: AnyField | undefined = current?.[part];
    if (!field) return null;
    found = field;
    current = field.kind === "object" || field.kind === "repeater" ? field.fields : undefined;
  }
  return found;
}

/** Every field path of a model, nested ones too, as a template reads them: `venue.name`, and `facts.label` for a row's field. */
export function fieldPaths(fields: FieldMap, prefix = ""): string[] {
  return Object.entries(fields).flatMap(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return field.kind === "object" || field.kind === "repeater" ? [path, ...fieldPaths(field.fields, path)] : [path];
  });
}

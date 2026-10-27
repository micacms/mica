/** The title of a repeater row in the form. */

import { singleValue, type RepeaterField } from "@micacms/core/internal";

import { humanise } from "@/composables/useField";

/** The collection or reference set of the `itemLabel` field, when that field is a single relation. */
export function rowLabelRelation(field: RepeaterField): string | undefined {
  const child = field.itemLabel ? field.fields[field.itemLabel] : undefined;
  return child?.kind === "relation" && !child.multiple ? child.collection : undefined;
}

/**
 * The value of the `itemLabel` field: text as it is, a relation by the title of
 * its entry (`titleOf`, else the ID). Without a value, "<Item> <number>".
 */
export function rowLabel(
  field: RepeaterField,
  row: Record<string, unknown>,
  index: number,
  titleOf: (id: string) => string | undefined = () => undefined,
): string {
  const key = field.itemLabel;
  const value = key ? singleValue(field.fields[key], row[key]) : undefined;
  if (typeof value === "string" && value.trim()) {
    return rowLabelRelation(field) ? (titleOf(value) ?? value) : value.trim();
  }
  return `${humanise(field.addLabel?.replace(/^Add\s+/i, "") ?? "Item")} ${index + 1}`;
}

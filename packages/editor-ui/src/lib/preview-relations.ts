/**
 * The entries that the form's document links to, for the live preview: a name
 * on the page can come from a related entry, and its hover label then offers
 * the relation field too, such as "Author".
 */

import { walkFields, type FieldMap } from "@micacms/core/internal";

import { fieldLabel } from "@/lib/field-labels";

/** The relation field that links to an entry: its path, its place in a list of links, and its label. */
export interface RelationLink {
  path: string;
  block?: number;
  label: string;
}

/** The key of a linked entry: its collection and its ID. */
export const linkKey = (collection: string, id: string): string => `${collection}\u0000${id}`;

/** The collection and the ID of a key. */
export const linkTarget = (key: string): { collection: string; id: string } => {
  const [collection = "", id = ""] = key.split("\u0000");
  return { collection, id };
};

/** Each entry that `data` links to, with the first relation field that names it. */
export function relationLinks(fields: FieldMap, data: Record<string, unknown>): Map<string, RelationLink> {
  const links = new Map<string, RelationLink>();
  walkFields(fields, data, (field, value, at) => {
    if (field.kind !== "relation") return;
    const path = at.join(".");
    const label = fieldLabel(fields, path) ?? path;
    const add = (id: unknown, block?: number) => {
      const key = typeof id === "string" && id !== "" ? linkKey(field.collection, id) : null;
      if (key && !links.has(key)) links.set(key, { path, label, ...(block === undefined ? {} : { block }) });
    };
    if (Array.isArray(value)) value.forEach((id, block) => add(id, block));
    else add(value);
  });
  return links;
}

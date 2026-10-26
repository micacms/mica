/**
 * The content model as an agent reads it: the model itself, which is plain
 * data already, and one line for each field kind about the value it stores.
 */

import type { FieldKind, Site } from "@micacms/core/internal";

/** What a value of each field kind looks like in `data`. An empty optional value is `null`. */
export const VALUE_FORMATS: Record<FieldKind, string> = {
  text: "One line of text.",
  textarea: "Text. It can contain line breaks, but no formatting.",
  richText: "Markdoc: Markdown, and `{% tag %}` tags that the website declares. Never HTML.",
  number: "A number. `integer` means a whole number.",
  boolean: "true or false. Never null.",
  date: "A date as YYYY-MM-DD. With `includeTime`, an ISO 8601 timestamp with an offset.",
  email: "An email address.",
  url: "An address that starts with http:// or https://.",
  id: "Lower-case letters, digits and hyphens. The id field of a collection is the entry's ID: the name of its folder, and the {id} of the collection's url.",
  select: "The `value` of one of the `options`. With `multiple`, a list of values.",
  object: "An object with the group's `fields`.",
  repeater: "A list of objects with the row's `fields`. Keep the `_key` of a row that exists; a new row gets one.",
  relation:
    "The ID of an entry in `collection`, or the id of an item when `collection` names a reference set (`find_reference_items`). With `multiple`, a list.",
  media:
    "The path of a file, relative to the content root, from `list_media` or `upload_media`. With `alt`, an object `{ path, alt }`. With `multiple`, a list.",
  color: "A hex colour such as #1a2b3c.",
  coordinates: "An object `{ lat, lng }`. A field with a map can also store `zoom`, from 0 to 22.",
  tags: "A list of short texts. Never null: empty is [].",
};

/** The model, with each part that this build cannot write marked, and the value formats. */
export function describeModel(model: Site, readOnly: ReadonlyMap<string, string>) {
  const mark = <T extends object>(kind: "collections" | "singletons", parts: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(parts).map(([name, part]) => {
        const reason = readOnly.get(`${kind}.${name}`);
        return [name, reason ? { ...part, readOnly: reason } : part];
      }),
    );

  return {
    collections: mark("collections", model.collections),
    singletons: mark("singletons", model.singletons),
    // Data of the website that relations point to. Read only: find an item's id with `find_reference_items`.
    references: Object.fromEntries(Object.values(model.references ?? {}).map((set) => [set.name, { label: set.label }])),
    valueFormats: VALUE_FORMATS,
  };
}

/** The loader's side of the field markers: which values get one, and when. */

import { mapFields, type FieldMap } from "@micacms/core/internal";

import { encodeMarker } from "./markers.js";

/** A path, an anchor or an address with a scheme: a template puts it in `href`, where a marker breaks the link. */
const ADDRESS = /^(\/|#|[a-z][a-z0-9+.-]*:)\S*$/i;
/** A phone number: a template makes a `tel:` link of it. */
const PHONE = /^\+?[\d\s()./-]{6,}$/;

/**
 * Adds a marker to each text and textarea value that a page shows as text, and
 * to each rich text: `renderRichText` takes it off again and marks each block.
 */
export function markTextFields(fields: FieldMap, data: Record<string, unknown>, document: string, id: string): Record<string, unknown> {
  return mapFields(fields, data, (field, value, path) =>
    typeof value === "string" &&
    value !== "" &&
    (field.kind === "richText" || ((field.kind === "text" || field.kind === "textarea") && !ADDRESS.test(value) && !PHONE.test(value)))
      ? value + encodeMarker({ document, id, path: path.join(".") })
      : value,
  );
}

/** Markers only in `astro dev`, and only for the preview's dev server. */
export const previewMarkersEnabled = (dev: boolean): boolean =>
  dev && ["1", "true"].includes(process.env["MICA_PREVIEW"] ?? "");

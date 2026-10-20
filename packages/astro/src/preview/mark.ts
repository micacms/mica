/** The loader's side of the field markers: which values get one, and when. */

import { mapFields, type FieldMap } from "@micacms/core/internal";

import { encodeMarker, type FieldMarker } from "./markers.js";

/** A path, an anchor or an address with a scheme: a template puts it in `href`, where a marker breaks the link. */
const ADDRESS = /^(\/|#|[a-z][a-z0-9+.-]*:)\S*$/i;
/** A phone number: a template makes a `tel:` link of it. */
const PHONE = /^\+?[\d\s()./-]{6,}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * An image with alt text, `{ src, alt }`, with the marker in its alt text: the
 * page writes it into `alt`. The `src` is not touched: in the content store it
 * is a reference that Astro resolves when the page renders.
 */
function markImage(image: unknown, marker: FieldMarker): unknown {
  return isRecord(image) && typeof image["alt"] === "string" ? { ...image, alt: image["alt"] + encodeMarker(marker) } : image;
}

/**
 * Adds a marker to each text and textarea value that a page shows as text, to
 * each rich text (`renderRichText` takes it off again and marks each block),
 * and to each image of a media field with alt text, with its place in a gallery.
 */
export function markFields(fields: FieldMap, data: Record<string, unknown>, document: string, id: string): Record<string, unknown> {
  return mapFields(fields, data, (field, value, path) => {
    const marker = { document, id, path: path.join(".") };
    if (field.kind === "media") return Array.isArray(value) ? value.map((item, block) => markImage(item, { ...marker, block })) : markImage(value, marker);
    if (typeof value !== "string" || value === "") return value;
    if (field.kind === "richText" || ((field.kind === "text" || field.kind === "textarea") && !ADDRESS.test(value) && !PHONE.test(value))) {
      return value + encodeMarker(marker);
    }
    return value;
  });
}

/** Markers only in `astro dev`, and only for the preview's dev server. */
export const previewMarkersEnabled = (dev: boolean): boolean =>
  dev && ["1", "true"].includes(process.env["MICA_PREVIEW"] ?? "");

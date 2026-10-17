/**
 * The file types that a `media()` field can hold. Mica keeps one table: the
 * editor serves files from its own origin, so the server checks the bytes of
 * each type, and a model can only choose from the table, never add to it.
 */

import type { MediaAccept, MediaFileType } from "./types.js";

export interface MediaFileTypeInfo {
  /** For the editor, in the plural: "GPX tracks". */
  label: string;
  /** The types that the server detects for it. */
  mimeTypes: readonly string[];
  /** Lowercase, without the dot. The first one names a new upload. */
  extensions: readonly string[];
}

export const MEDIA_FILE_TYPES: Record<MediaFileType, MediaFileTypeInfo> = {
  image: {
    label: "Images",
    mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"],
    extensions: ["jpg", "jpeg", "png", "gif", "webp", "avif"],
  },
  pdf: { label: "PDF documents", mimeTypes: ["application/pdf"], extensions: ["pdf"] },
  gpx: { label: "GPX tracks", mimeTypes: ["application/gpx+xml"], extensions: ["gpx"] },
  kml: { label: "KML files", mimeTypes: ["application/vnd.google-earth.kml+xml"], extensions: ["kml"] },
  geojson: { label: "GeoJSON files", mimeTypes: ["application/geo+json"], extensions: ["geojson"] },
  zip: { label: "ZIP archives", mimeTypes: ["application/zip"], extensions: ["zip"] },
  csv: { label: "CSV tables", mimeTypes: ["text/csv"], extensions: ["csv"] },
};

export const MEDIA_FILE_TYPE_NAMES = Object.keys(MEDIA_FILE_TYPES) as MediaFileType[];

export const isMediaFileType = (name: unknown): name is MediaFileType =>
  typeof name === "string" && Object.hasOwn(MEDIA_FILE_TYPES, name);

/** The types that a field's `accept` allows. Without `accept`, every type. */
export function acceptedFileTypes(accept: MediaAccept | undefined): readonly MediaFileType[] {
  if (accept === undefined || accept === "any") return MEDIA_FILE_TYPE_NAMES;
  if (accept === "image") return ["image"];
  if (accept === "document") return ["pdf"];
  return accept;
}

/** The name of the table entry that a detected type belongs to. */
export function mediaFileTypeOf(mimeType: string): MediaFileType | undefined {
  return MEDIA_FILE_TYPE_NAMES.find((name) => MEDIA_FILE_TYPES[name].mimeTypes.includes(mimeType));
}

/** For a message: "GPX tracks or KML files". */
export function acceptLabel(accept: MediaAccept | undefined): string {
  const labels = acceptedFileTypes(accept).map((name) => MEDIA_FILE_TYPES[name].label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}` : labels[0]!;
}

/**
 * Content sniffing for uploads.
 *
 * The browser-supplied MIME type is attacker-controlled and must not be
 * trusted: an executable renamed to `.jpg` arrives as `image/jpeg`. The stored
 * type is derived from the bytes instead, and the extension is regenerated
 * from it rather than taken from the filename.
 */

import { acceptedFileTypes, isMediaFileType, MEDIA_FILE_TYPES, mediaFileTypeOf, type MediaAccept } from "@micacms/core/internal";

export interface DetectedType {
  mimeType: string;
  extension: string;
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  Array.from(bytes.slice(offset, offset + length), (byte) => String.fromCharCode(byte)).join("");

/**
 * The type of a file from its first bytes. `name` decides only for formats
 * whose bytes do not name them: a ZIP name for a ZIP container (Office files
 * are ZIP files too), and a CSV name for text.
 */
export function detectFileType(bytes: Uint8Array, name = ""): DetectedType | null {
  if (bytes.length < 12) return textType(bytes, name);

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", extension: "png" };
  }

  const header = ascii(bytes, 0, 6);
  if (header === "GIF87a" || header === "GIF89a") {
    return { mimeType: "image/gif", extension: "gif" };
  }

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }

  // ISO base media formats declare their brand at offset 8, after the box size.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") {
      return { mimeType: "image/avif", extension: "avif" };
    }
    if (brand === "heic" || brand === "heix" || brand === "mif1") {
      return { mimeType: "image/heic", extension: "heic" };
    }
    if (brand === "isom" || brand === "mp42" || brand === "M4V ") {
      return { mimeType: "video/mp4", extension: "mp4" };
    }
  }

  if (ascii(bytes, 0, 5) === "%PDF-") {
    return { mimeType: "application/pdf", extension: "pdf" };
  }

  if ((startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) && hasExtension(name, "zip")) {
    return { mimeType: "application/zip", extension: "zip" };
  }

  if (isSvg(bytes)) {
    return { mimeType: "image/svg+xml", extension: "svg" };
  }

  return textType(bytes, name);
}

const hasExtension = (name: string, extension: string): boolean => name.toLowerCase().endsWith(`.${extension}`);

/**
 * Text formats by their leading text: GPX and KML by the root element, GeoJSON
 * by its `type`, CSV by its name. Only UTF-8 without NUL bytes counts as text.
 * The text is read as text, never parsed, so no XML or JSON parser sees it.
 */
function textType(bytes: Uint8Array, name: string): DetectedType | null {
  const text = utf8(bytes.slice(0, 4096));
  if (text === null) return null;
  const head = text.replace(/^\uFEFF/, "").trimStart();

  const root = /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(gpx|kml)[\s>]/i.exec(head)?.[1]?.toLowerCase();
  if (root === "gpx") return { mimeType: "application/gpx+xml", extension: "gpx" };
  if (root === "kml") return { mimeType: "application/vnd.google-earth.kml+xml", extension: "kml" };

  if (head.startsWith("{") && GEOJSON_TYPE.test(head)) {
    return { mimeType: "application/geo+json", extension: "geojson" };
  }
  if (hasExtension(name, "csv") && head !== "" && !head.startsWith("<")) {
    return { mimeType: "text/csv", extension: "csv" };
  }
  return null;
}

const GEOJSON_TYPE =
  /"type"\s*:\s*"(?:FeatureCollection|Feature|Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)"/;

/** The text of UTF-8 bytes, or null for other bytes. A character cut at the end is left out. */
function utf8(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
  } catch {
    return null;
  }
}

/** SVG has no magic number, so look for a root `<svg>` in the leading text. */
function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 1024))
    .trimStart()
    .toLowerCase();

  if (head.startsWith("<svg")) return true;
  if (head.startsWith("<?xml") || head.startsWith("<!doctype svg")) {
    return head.includes("<svg");
  }
  return false;
}

// No HEIC: Astro's image service cannot read it, so a site could not show it.
export const isImageType = (mimeType: string): boolean => MEDIA_FILE_TYPES.image.mimeTypes.includes(mimeType);

/**
 * Whether a detected type is acceptable for a field's `accept` setting.
 * `any` deliberately does not mean "anything": only the types in the table of
 * `@micacms/core` can be stored at all.
 */
export function isAccepted(mimeType: string, accept: MediaAccept | undefined): boolean {
  const type = mediaFileTypeOf(mimeType);
  return type !== undefined && acceptedFileTypes(accept).includes(type);
}

/** The `accept` of an upload request: a group, or types separated by commas. Null for an unknown type. */
export function acceptFromQuery(value: string | undefined): MediaAccept | null {
  if (value === undefined || value === "" || value === "any") return "any";
  if (value === "image" || value === "document") return value;
  const names = value.split(",");
  return names.every(isMediaFileType) ? names : null;
}

/** A video is large for a Git repository, and the media list cannot show one. */
export const VIDEO_TYPE = "video/mp4";

/**
 * SVG can carry scripts, so Mica neither stores nor shows it (#86). It is still
 * detected, so that the refusal can say why.
 */
export const SVG_TYPE = "image/svg+xml";

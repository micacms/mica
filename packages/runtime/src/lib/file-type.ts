/**
 * Content sniffing for uploads.
 *
 * The browser-supplied MIME type is attacker-controlled and must not be
 * trusted: an executable renamed to `.jpg` arrives as `image/jpeg`. The stored
 * type is derived from the bytes instead, and the extension is regenerated
 * from it rather than taken from the filename.
 */

export interface DetectedType {
  mimeType: string;
  extension: string;
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  Array.from(bytes.slice(offset, offset + length), (byte) => String.fromCharCode(byte)).join("");

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length < 12) return null;

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

  if (isSvg(bytes)) {
    return { mimeType: "image/svg+xml", extension: "svg" };
  }

  return null;
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
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]);

const DOCUMENT_TYPES = new Set(["application/pdf"]);

export const isImageType = (mimeType: string): boolean => IMAGE_TYPES.has(mimeType);

/**
 * Whether a detected type is acceptable for a field's `accept` setting.
 * `any` deliberately does not mean "anything": only the types listed here can
 * be stored at all.
 */
export function isAccepted(mimeType: string, accept: "image" | "document" | "any"): boolean {
  if (accept === "image") return IMAGE_TYPES.has(mimeType);
  if (accept === "document") return DOCUMENT_TYPES.has(mimeType);
  return IMAGE_TYPES.has(mimeType) || DOCUMENT_TYPES.has(mimeType) || mimeType === "video/mp4";
}

/**
 * SVG can carry scripts, so Mica neither stores nor shows it (#86). It is still
 * detected, so that the refusal can say why.
 */
export const SVG_TYPE = "image/svg+xml";

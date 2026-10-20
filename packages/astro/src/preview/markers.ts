/**
 * Field markers for the live preview: invisible characters after a text value
 * that name its document and its field. Only a dev server with `MICA_PREVIEW`
 * adds them, so a build never has them. The preview script in the page reads
 * them back from the text, and the editor opens the field that a click names.
 */

// No imports: the preview script in the page uses this file too.

/** Starts a marker: INVISIBLE PLUS, which no text that people write has. */
const START = "\u2064";
/** The digits, one for each four bits: the variation selectors VS1 to VS16, which show nothing. */
const FIRST_DIGIT = 0xfe00;
/** Ends each part, also the last one: a marker that a template cut short has no end, and is left out. */
const SEPARATOR = "\u001f";

/** The field that a value of the page comes from. */
export interface FieldMarker {
  /** The collection or the singleton. */
  document: string;
  /** The entry's slug, or the singleton's name. */
  id: string;
  /** The field's path as the editor names it: `title`, `seo.title`, `facts.2.label`. */
  path: string;
}

export function encodeMarker(marker: FieldMarker): string {
  const bytes = new TextEncoder().encode([marker.document, marker.id, marker.path, ""].join(SEPARATOR));
  let out = START;
  for (const byte of bytes) out += String.fromCharCode(FIRST_DIGIT + (byte >> 4), FIRST_DIGIT + (byte & 15));
  return out;
}

/** A new expression each time: a global one keeps its position between calls. */
const markerPattern = () => new RegExp(`${START}([\\ufe00-\\ufe0f]+)`, "gu");

/** The markers in a text, in order. A marker that a template cut short is left out. */
export function decodeMarkers(text: string): FieldMarker[] {
  if (!text.includes(START)) return [];
  const found: FieldMarker[] = [];
  for (const match of text.matchAll(markerPattern())) {
    const digits = match[1]!;
    if (digits.length % 2 !== 0) continue;
    const bytes = new Uint8Array(digits.length / 2);
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = ((digits.charCodeAt(2 * index) - FIRST_DIGIT) << 4) | (digits.charCodeAt(2 * index + 1) - FIRST_DIGIT);
    }
    try {
      const parts = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(SEPARATOR);
      if (parts.length === 4 && parts[3] === "") found.push({ document: parts[0]!, id: parts[1]!, path: parts[2]! });
    } catch {
      // Not one of ours.
    }
  }
  return found;
}

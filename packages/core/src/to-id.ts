/**
 * ID generation.
 *
 * Uses Unicode normalisation to strip diacritics, with an explicit map for the
 * German-speaking market where "ü" must become "ue" rather than "u".
 */

const TRANSLITERATE: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "ae",
  Ö: "oe",
  Ü: "ue",
  ß: "ss",
  æ: "ae",
  ø: "oe",
  å: "aa",
  œ: "oe",
  đ: "d",
  ł: "l",
  ñ: "n",
  þ: "th",
  ð: "d",
};

export function toId(input: string, maxLength = 96): string {
  const transliterated = Array.from(input)
    .map((char) => TRANSLITERATE[char] ?? char)
    .join("");

  const id = transliterated
    // Decompose accents into base char + combining mark, then drop the marks.
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (id.length <= maxLength) return id;
  // Trim at a separator so the ID never ends mid-word.
  return id.slice(0, maxLength).replace(/-+[^-]*$/, "").replace(/-+$/, "");
}

/** `true` when the string is already a well-formed ID. */
export function isValidId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

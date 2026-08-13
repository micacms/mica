/**
 * Slug generation.
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

export function slugify(input: string, maxLength = 96): string {
  const transliterated = Array.from(input)
    .map((char) => TRANSLITERATE[char] ?? char)
    .join("");

  const slug = transliterated
    // Decompose accents into base char + combining mark, then drop the marks.
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length <= maxLength) return slug;
  // Trim at a separator so the slug never ends mid-word.
  return slug.slice(0, maxLength).replace(/-+[^-]*$/, "").replace(/-+$/, "");
}

/** `true` when the string is already a well-formed slug. */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/**
 * Appends `-2`, `-3`, … until the slug is not in `taken`.
 * `taken` should exclude the entry being edited.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;

  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

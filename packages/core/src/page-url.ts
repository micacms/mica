/**
 * The page of an entry or a singleton on the website: the `url` option of the
 * model, such as `/news/{slug}`. Mica only links to it; it never calls the
 * website.
 */

const SLUG = "{slug}";

/** Why a `url` option is not valid, or null. A collection's address names `{slug}` once; a singleton's names nothing. */
export function pageUrlProblem(url: unknown, kind: "collection" | "singleton"): string | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return "it must be a path that starts with one /, such as /news/{slug}";
  if (/[\s?#\\]/.test(url)) return "it must be a path without spaces, ? or #";
  const placeholders = url.match(/\{[^}]*\}/g) ?? [];
  if (kind === "singleton") return placeholders.length === 0 ? null : "a singleton has one page, so its address has no {slug}";
  return placeholders.length === 1 && placeholders[0] === SLUG ? null : "a collection's address must name {slug} once";
}

/** The page of one entry, or of a singleton without `slug`. */
export function pageUrl(url: string, slug?: string): string {
  return slug === undefined ? url : url.replace(SLUG, encodeURIComponent(slug));
}

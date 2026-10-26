/**
 * The page of an entry or a singleton on the website: the `url` option of the
 * model, such as `/news/{slug}` or `/{activity}/{slug}`. Mica only links to
 * it; it never calls the website.
 */

import type { AnyField, FieldMap } from "./types.js";

const PLACEHOLDER = /\{([^}]*)\}/g;

/** The names in an address, in their order: `/{activity}/{slug}` gives `activity` and `slug`. */
export function pagePlaceholders(url: string): string[] {
  return [...url.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

/**
 * A field that can give a part of an address: one value that the developer
 * controls, so that it fits a path. A relation gives the slug of its entry.
 * Free text does not: a title with "/" or "&" is not a part of a path.
 */
function givesPathPart(field: AnyField | undefined): boolean {
  switch (field?.kind) {
    case "select":
    case "relation":
      return !field.multiple;
    case "date":
      return !field.includeTime;
    default:
      return false;
  }
}

/**
 * Why a `url` option is not valid, or null. A collection's address names
 * `{slug}` once, and other fields of the collection with one value, each as a
 * whole part of the path; a singleton's names nothing.
 */
export function pageUrlProblem(url: unknown, kind: "collection" | "singleton", fields: FieldMap = {}): string | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return "it must be a path that starts with one /, such as /news/{slug}";
  if (/[\s?#\\]/.test(url)) return "it must be a path without spaces, ? or #";
  const names = pagePlaceholders(url);
  if (kind === "singleton") return names.length === 0 ? null : "a singleton has one page, so its address has no {slug}";
  if (names.filter((name) => name === "slug").length !== 1) return "a collection's address must name {slug} once";
  const other = names.find((name) => name !== "slug" && !givesPathPart(fields[name]));
  if (other !== undefined) return `{${other}} must name a select, relation or date field of the collection, with one value`;
  // Mica reads the entry back from a path of the preview: in one part with the slug, a "-" of the slug would be ambiguous.
  const shared = url.split("/").find((part) => pagePlaceholders(part).some((name) => name !== "slug" && part !== `{${name}}`));
  if (shared !== undefined) return `"${shared}" must be a name alone, between two /, such as /{activity}/{slug}`;
  return null;
}

/**
 * The page of one entry: `{slug}` is the slug, each other name the value of
 * that field in `data`. Null when a value is empty, because the page has no
 * address then. Without `slug`, the address of a singleton as it is.
 */
export function pageUrl(url: string, slug?: string, data: Record<string, unknown> = {}): string | null {
  if (slug === undefined) return url;
  let empty = false;
  const page = url.replace(PLACEHOLDER, (_match, name: string) => {
    const value = name === "slug" ? slug : data[name];
    if (typeof value !== "string" || value === "") empty = true;
    return typeof value === "string" ? encodeURIComponent(value) : "";
  });
  return empty ? null : page;
}

/**
 * The slug of the entry whose page is `path`, by the address `url`, and the
 * length of the address's own text, so that the most specific address wins.
 * Null when the path is not one of its pages.
 */
export function slugAtPath(url: string, path: string): { slug: string; literal: number } | null {
  const parts = url.split(PLACEHOLDER);
  let pattern = "";
  let literal = 0;
  parts.forEach((part, index) => {
    // split() with a group gives the text and the names in turn: even indexes are text.
    if (index % 2 === 0) {
      pattern += part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      literal += part.length;
    } else pattern += part === "slug" ? "(?<slug>[^/]+)" : "[^/]+";
  });
  const slug = new RegExp(`^${pattern}$`).exec(path)?.groups?.["slug"];
  if (slug === undefined) return null;
  try {
    return { slug: decodeURIComponent(slug), literal };
  } catch {
    // A link with a stray "%", such as /news/100%: no entry has that slug.
    return null;
  }
}

/**
 * The page of an entry or a singleton on the website: the `url` option of the
 * model, such as `/news/{id}` or `/{activity}/{id}`, and `{locale}` on a site
 * with locales, such as `/{locale}/news/{id}`. Mica only links to it; it never
 * calls the website.
 */

import type { AnyField, FieldMap, Site } from "./types.js";

// A name holds no "{": a long run of "{" stays linear to scan.
const PLACEHOLDER = /\{([^{}]*)\}/g;

/** What an address with `{locale}` needs of the site. */
export type AddressLocales = Pick<Site, "locales" | "defaultLocale" | "prefixDefaultLocale">;

/**
 * The value of `{locale}` in the address of `locale`, else of the default locale: empty for the default locale
 * without a prefix (`prefixDefaultLocale`), so that `/{locale}/news` is `/news`. Undefined for a site without
 * locales, whose `{locale}` can be a field.
 */
export function addressLocale(site: AddressLocales | null | undefined, locale?: string | null): string | undefined {
  if (!site?.locales) return undefined;
  const main = site.defaultLocale ?? "";
  const chosen = locale ?? main;
  return chosen === main && !site.prefixDefaultLocale ? "" : chosen;
}

/** The names in an address, in their order: `/{activity}/{id}` gives `activity` and `id`. */
export function pagePlaceholders(url: string): string[] {
  return [...url.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

/**
 * A field that can give a part of an address: one value that the developer
 * controls, so that it fits a path. A relation gives the ID of its entry.
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
 * `{id}` once, and other fields of the collection with one value, each as a
 * whole part of the path; a singleton's names nothing. On a site with
 * `locales`, both can name `{locale}` once, as a whole part of the path: the
 * page's language. On a site without, `{locale}` can be a field.
 */
export function pageUrlProblem(url: unknown, kind: "collection" | "singleton", fields: FieldMap = {}, locales = false): string | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return "it must be a path that starts with one /, such as /news/{id}";
  if (/[\s?#\\]/.test(url)) return "it must be a path without spaces, ? or #";
  if (/[{}]/.test(url.replace(PLACEHOLDER, ""))) return "it must name each field as {name}, without other { or }";
  const all = pagePlaceholders(url);
  const localeCount = all.filter((name) => name === "locale").length;
  if (localeCount > 0 && !locales && !fields["locale"]) return "{locale} needs the site's locales";
  if (localeCount > 0 && locales && fields["locale"]) return "{locale} is the page's language on a site with locales: rename the field \"locale\"";
  if (localeCount > 1 && locales) return "it can name {locale} once";
  if (localeCount === 1 && locales && !url.split("/").includes("{locale}")) return "{locale} must be a part alone, between two /, such as /{locale}/news/{id}";
  const names = locales ? all.filter((name) => name !== "locale") : all;
  if (kind === "singleton") return names.length === 0 ? null : "a singleton has one page, so its address has no {id}";
  if (names.filter((name) => name === "id").length !== 1) return "a collection's address must name {id} once";
  const other = names.find((name) => name !== "id" && !givesPathPart(fields[name]));
  if (other !== undefined) return `{${other}} must name a select, relation or date field of the collection, with one value`;
  // Mica reads the entry back from a path of the preview: in one part with the ID, a "-" of the ID would be ambiguous.
  const shared = url.split("/").find((part) => pagePlaceholders(part).some((name) => name !== "id" && part !== `{${name}}`));
  if (shared !== undefined) return `"${shared}" must be a name alone, between two /, such as /{activity}/{id}`;
  return null;
}

/**
 * The page of one entry: `{id}` is the ID, each other name the value of
 * that field in `data`, and `{locale}` is `locale`, from `addressLocale`.
 * Null when a value is empty, because the page has no address then. Without
 * `id`, the address of a singleton.
 */
export function pageUrl(url: string, id?: string, data: Record<string, unknown> = {}, locale?: string): string | null {
  // An empty {locale}, of the default locale without a prefix, goes with its "/": /{locale}/news is /news.
  // Without a locale, on a site without locales, {locale} is a field.
  const located = locale === undefined ? url : url.replace("/{locale}", locale ? `/${locale}` : "") || "/";
  if (id === undefined) return located;
  let empty = false;
  const page = located.replace(PLACEHOLDER, (_match, name: string) => {
    const value = name === "id" ? id : data[name];
    if (typeof value !== "string" || value === "") empty = true;
    return typeof value === "string" ? encodeURIComponent(value) : "";
  });
  return empty ? null : page;
}

/**
 * The ID of the entry whose page is `path`, by the address `url`, its locale
 * (null for an address without `{locale}`), and the length of the address's
 * own text, so that the most specific address wins. Null when the path is not
 * one of its pages. For an address without `{id}`, as a singleton's, the ID
 * is empty.
 */
export function idAtPath(url: string, path: string, site?: AddressLocales | null): { id: string; locale: string | null; literal: number } | null {
  const parts = url.split(PLACEHOLDER);
  const named = (name: string) => parts.some((part, index) => index % 2 === 1 && part === name);
  // On a site without locales, {locale} is a field like another one.
  const language = !!site?.locales;
  let pattern = "";
  let literal = 0;
  parts.forEach((part, index) => {
    // split() with a group gives the text and the names in turn: even indexes are text.
    if (index % 2 === 0) {
      // "/{locale}": the "/" belongs to the locale, which the default locale leaves out without a prefix.
      const text = language && parts[index + 1] === "locale" && part.endsWith("/") ? part.slice(0, -1) : part;
      pattern += text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      literal += text.length;
    } else if (language && part === "locale") {
      pattern += site?.prefixDefaultLocale ? "/(?<locale>[^/]+)" : "(?:/(?<locale>[^/]+))?";
    } else pattern += part === "id" ? "(?<id>[^/]+)" : "[^/]+";
  });
  const expression = new RegExp(`^${pattern}$`);
  // The home page of a default locale without a prefix: "/{locale}" leaves nothing of the path "/".
  const match = expression.exec(path) ?? (path === "/" ? expression.exec("") : null);
  if (!match) return null;
  const groups = match.groups ?? {};

  let locale: string | null = null;
  if (language && named("locale")) {
    const found = groups["locale"];
    const main = site?.defaultLocale ?? null;
    // A prefix that is not a locale, or the default locale's that the site does not write, is another page.
    if (found !== undefined && (!site?.locales?.includes(found) || (found === main && !site.prefixDefaultLocale))) return null;
    locale = found ?? main;
  }
  if (!named("id")) return { id: "", locale, literal };
  try {
    return { id: decodeURIComponent(groups["id"]!), locale, literal };
  } catch {
    // A link with a stray "%", such as /news/100%: no entry has that ID.
    return null;
  }
}

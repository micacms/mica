/**
 * Typed helpers over the generated collections.
 *
 * Singletons arrive as one-entry collections, which is uniform but clumsy to
 * read in a template. These wrappers restore the ergonomics and, more usefully,
 * give the return values their model-derived types.
 */

import { getCollection, getEntry } from "astro:content";

import type { InferSingleton } from "@micacms/core";

import type { site } from "../mica";

type Model = typeof site;

export type SiteSettings = InferSingleton<Model["singletons"]["site"]>;
export type Navigation = InferSingleton<Model["singletons"]["navigation"]>;
export type Theme = InferSingleton<Model["singletons"]["theme"]>;

/**
 * One fetch per singleton per build. Astro's content store is already cached,
 * but every page renders the layout, so memoising avoids the repeated lookup.
 */
const cache = new Map<string, unknown>();

async function global<T>(name: string): Promise<T> {
  if (!cache.has(name)) {
    const entry = await getEntry(name as "site", name);
    if (!entry) {
      throw new Error(
        `The "${name}" settings have not been saved in the CMS yet. ` +
          `Open the CMS, fill them in, and rebuild.`,
      );
    }
    cache.set(name, entry.data);
  }
  return cache.get(name) as T;
}

export const getSiteSettings = () => global<SiteSettings>("site");
export const getNavigation = () => global<Navigation>("navigation");
export const getTheme = () => global<Theme>("theme");

/* ------------------------------------------------------------------ *
 * Collection helpers
 * ------------------------------------------------------------------ */

/**
 * Newest first, by publication date.
 *
 * There is no infrastructural fallback any more: an article with no
 * `publishDate` sorts last, which is visible in the editor and fixable there.
 * The old fallback read a database timestamp, so the order of two undated
 * articles depended on when someone last opened them.
 */
export async function getNews() {
  const items = await getCollection("news");
  return [...items].sort((a, b) =>
    (b.data.publishDate ?? "").localeCompare(a.data.publishDate ?? ""),
  );
}

/** Projects in the order the repository records, newest year first. */
export async function getProjects(options: { featuredOnly?: boolean } = {}) {
  const items = await getCollection("projects");
  const filtered = options.featuredOnly
    ? items.filter((item) => item.data.featured)
    : items;

  return [...filtered].sort((a, b) => (b.data.year ?? 0) - (a.data.year ?? 0));
}

/** Team members in the order an editor arranged them. */
export async function getTeam() {
  const items = await getCollection("team");
  return [...items].sort(
    (a, b) => a.data._mica.position - b.data._mica.position,
  );
}

export async function getFeaturedTeam() {
  const items = await getCollection("team");
  return [...items]
    .filter((item) => item.data.featured)
    .sort((a, b) => a.data._mica.position - b.data._mica.position);
}

export async function getPages() {
  const items = await getCollection("pages");
  return [...items].sort(
    (a, b) => a.data._mica.position - b.data._mica.position,
  );
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

/** Formats an ISO date for display, in the site's locale. */
export function formatDate(iso: string | null, locale = "de-CH"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
}

/**
 * Plain-text excerpt from a rich-text field, for meta descriptions.
 *
 * The field is Markdoc, so the markup to remove is punctuation rather than
 * tags. Deliberately not a full parse: a meta description is 160 characters of
 * the opening prose, and rendering the whole document to throw all but the
 * first sentence away would be work for nothing.
 */
export function toPlainText(markdoc: string | null, maxLength = 160): string {
  if (!markdoc) return "";

  const text = markdoc
    // Fenced code and Markdoc tags contribute nothing to a description.
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\{%[\s\S]*?%\}/g, " ")
    // Link and image syntax: keep the label, drop the target.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Leading block markers, then inline emphasis.
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\\([\\`*_{}[\]<>#>\-.])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "")}…`;
}

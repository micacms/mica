/**
 * Typed helpers over the generated collections.
 *
 * Singletons arrive as one-entry collections, which is uniform but clumsy to
 * read in a template. These wrappers restore the ergonomics and, more usefully,
 * give the return values their model-derived types.
 */

import { getCollection, getEntry } from "astro:content";

import type { SingletonDocument } from "@micacms/astro";

import type { site } from "../mica";

type Model = typeof site;

export type SiteSettings = SingletonDocument<Model, "site">;
export type Navigation = SingletonDocument<Model, "navigation">;
export type Theme = SingletonDocument<Model, "theme">;

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

/** Events with the upcoming ones first (soonest first), then the past ones (latest first). */
export async function getEvents(now = new Date()) {
  const items = await getCollection("events");
  const time = (item: (typeof items)[number]) => new Date(item.data.startsAt ?? 0).getTime();
  const upcoming = items.filter((item) => time(item) >= now.getTime()).sort((a, b) => time(a) - time(b));
  const past = items.filter((item) => time(item) < now.getTime()).sort((a, b) => time(b) - time(a));
  return { upcoming, past };
}

/**
 * A relation seen from the other side. A project names its team, and the team
 * member does not name the project, so the page asks the collection and filters.
 */
export async function getProjectsOf(memberSlug: string) {
  const items = await getProjects();
  return items.filter((item) => item.data.team.includes(memberSlug));
}

/** The events in which a team member speaks, soonest first. */
export async function getEventsOf(memberSlug: string) {
  const items = await getCollection("events");
  return items
    .filter((item) => item.data.speakers.includes(memberSlug))
    .sort((a, b) => (a.data.startsAt ?? "").localeCompare(b.data.startsAt ?? ""));
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

/** Labels for the `category` options of a project. */
export const CATEGORY_LABELS: Record<string, string> = {
  strategy: "Strategy",
  operations: "Operations",
  technology: "Technology",
  "public-sector": "Public sector",
};

/** Labels for the `format` options of an event. */
export const FORMAT_LABELS: Record<string, string> = {
  "in-person": "In person",
  online: "Online",
};

/** Formats an ISO date for display, in the site's locale. */
export function formatDate(iso: string | null, locale = "en"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
}

/**
 * Formats a date with time as the wall clock of its own offset.
 *
 * A stored value like `2026-11-12T18:30:00+00:00` names its time zone. Showing
 * it in the zone of the build machine would change the hour, so the offset is
 * applied by hand and the zone is named in the text.
 */
export function formatDateTime(iso: string | null, locale = "en"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const match = iso.match(/([+-])(\d{2}):(\d{2})$/);
  const offset = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  const shifted = new Date(date.getTime() + offset * 60_000);
  const text = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(shifted);
  return `${text} (UTC${match ? `${match[1]}${match[2]}:${match[3]}` : "+00:00"})`;
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

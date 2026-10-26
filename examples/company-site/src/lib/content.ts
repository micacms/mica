/**
 * Typed helpers over the generated collections.
 *
 * Singletons arrive as one-entry collections; `getSingleton` reads one with
 * its model-derived type. Collections that the editor arranges by hand come in
 * the editor's order with `inEditorOrder`.
 */

import { getCollection, type CollectionEntry } from "astro:content";

import { getSingleton, inEditorOrder, type SingletonDocument } from "@micacms/astro";

import { site } from "../mica";

type Model = typeof site;

export type SiteSettings = SingletonDocument<Model, "general">;
export type Navigation = SingletonDocument<Model, "navigation">;
export type Theme = SingletonDocument<Model, "theme">;

export const getSiteSettings = () => getSingleton(site, "general");
export const getNavigation = () => getSingleton(site, "navigation");
export const getTheme = () => getSingleton(site, "theme");
export const getLabels = () => getSingleton(site, "labels");
export const getHomePage = () => getSingleton(site, "homePage");

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

/** The page of a project: its category and its slug, as the model's `url` says. */
export const projectPath = (project: { id: string; data: { category: string } }): string => `/projects/${project.data.category}/${project.id}/`;

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
  return [...items].sort(inEditorOrder);
}

export async function getFeaturedTeam() {
  const items = await getCollection("team");
  return [...items]
    .filter((item) => item.data.featured)
    .sort(inEditorOrder);
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
  return [...items].sort(inEditorOrder);
}

/**
 * The URL of the page of each list template. It is the collection's own,
 * because the collection's pages are below it: /news/ lists /news/hello/.
 */
export const LIST_PAGES = { projects: "projects", news: "news", events: "events", team: "team", glossary: "glossary" } as const;

/** What is wrong with the list pages: a wrong URL, a template on two pages, or a list without a page. */
export function listPageProblems(pages: ReadonlyArray<CollectionEntry<"pages">>): string[] {
  const problems: string[] = [];
  for (const [template, slug] of Object.entries(LIST_PAGES)) {
    const found = pages.filter((page) => page.data.template === template);
    if (found.length === 0) problems.push(`No page has the template "${template}", so /${slug}/ does not exist.`);
    if (found.length > 1) problems.push(`The pages ${found.map((page) => page.id).join(", ")} all have the template "${template}". Give it to one page.`);
    for (const page of found) {
      if (page.id !== slug) problems.push(`The page "${page.id}" has the template "${template}", so its URL must be "${slug}".`);
    }
  }
  return problems;
}

/** The page with a list template, for a link to it: null while no page has it. */
export async function getListPage(template: keyof typeof LIST_PAGES) {
  return (await getCollection("pages")).find((page) => page.data.template === template) ?? null;
}

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

/** The label of a select option, as the model gives it to the editor: "public-sector" → "Public sector". */
export function optionLabel(field: { options: readonly { label: string; value: string }[] }, value: string): string {
  return field.options.find((option) => option.value === value)?.label ?? value;
}

export const categoryLabel = (value: string) => optionLabel(site.collections.projects.fields.category, value);
export const formatLabel = (value: string) => optionLabel(site.collections.events.fields.format, value);
export const platformLabel = (value: string) => optionLabel(site.singletons.general.fields.social.fields.platform, value);

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
  const clock = wallClock(iso);
  if (!clock) return "";
  const text = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(clock.date);
  return `${text} (UTC${clock.offset})`;
}

/** Day and short month of a date with time, for a calendar badge. */
export function dateBadge(iso: string | null, locale = "en"): { day: string; month: string } | null {
  const clock = wallClock(iso);
  if (!clock) return null;
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(clock.date);
  return { day: part({ day: "numeric" }), month: part({ month: "short" }) };
}

/** The instant shifted by its own offset, so that UTC formatting shows its wall clock. */
function wallClock(iso: string | null): { date: Date; offset: string } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const match = iso.match(/([+-])(\d{2}):(\d{2})$/);
  const minutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return {
    date: new Date(date.getTime() + minutes * 60_000),
    offset: match ? `${match[1]}${match[2]}:${match[3]}` : "+00:00",
  };
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

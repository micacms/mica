import { getCollection } from "astro:content";
import { getSingleton, inEditorOrder, type SingletonDocument } from "@micacms/astro";
import { site } from "../mica";

type Model = typeof site;
export type SiteSettings = SingletonDocument<Model, "site">;
export type Navigation = SingletonDocument<Model, "navigation">;
export type Home = SingletonDocument<Model, "home">;
export type Imprint = SingletonDocument<Model, "imprint">;
export type Pages = SingletonDocument<Model, "pages">;
export type Compare = SingletonDocument<Model, "compare">;

export const getSite = () => getSingleton(site, "site");
export const getNavigation = () => getSingleton(site, "navigation");
export const getHome = () => getSingleton(site, "home");
export const getImprint = () => getSingleton(site, "imprint");
export const getPages = () => getSingleton(site, "pages");
export const getCompare = () => getSingleton(site, "compare");

/** The sections of the documentation, in the order the index and the sidebar show them. */
export const DOC_SECTIONS = [
  { key: "start", label: "Start here" },
  { key: "build", label: "Build" },
  { key: "edit", label: "Edit" },
  { key: "operate", label: "Operate" },
  { key: "reference", label: "Reference" },
] as const;

export async function getDocs() {
  return [...(await getCollection("docs"))].sort(inEditorOrder);
}

/** 0.1.10 is newer than 0.1.9, which is not what comparing the strings says. */
function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);

  for (let part = 0; part < Math.max(left.length, right.length); part++) {
    const difference = (left[part] ?? 0) - (right[part] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * Newest first — by date, then by version.
 *
 * The version is the tiebreak because two releases on one day are normal: a
 * fix follows the release it fixes within the hour. Sorting on the date alone
 * left same-day entries in whatever order the loader read them, which put
 * 0.0.2 above 0.0.4 on the changelog.
 */
export async function getReleases() {
  return [...(await getCollection("releases"))].sort(
    (a, b) =>
      b.data.publishDate.localeCompare(a.data.publishDate) ||
      compareVersions(b.data.version, a.data.version),
  );
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export async function getComparisons() {
  return [...(await getCollection("comparisons"))].sort(inEditorOrder);
}

/** The value of one product for one table row. A missing row stops the build, so that no cell stays empty. */
export function factValue(entry: { id: string; data: { facts: { key: string; value: string }[] } }, key: string): string {
  const fact = entry.data.facts.find((item) => item.key === key);
  if (!fact) throw new Error(`The comparison "${entry.id}" has no value for the row "${key}".`);
  return fact.value;
}

import { getCollection, getEntry } from "astro:content";
import type { InferSingleton } from "@micacms/core";
import type { site } from "../mica";

type Model = typeof site;
export type SiteSettings = InferSingleton<Model["singletons"]["site"]>;
export type Navigation = InferSingleton<Model["singletons"]["navigation"]>;
export type Home = InferSingleton<Model["singletons"]["home"]>;
export type Product = InferSingleton<Model["singletons"]["product"]>;
export type Imprint = InferSingleton<Model["singletons"]["imprint"]>;

const globals = new Map<string, unknown>();

async function getGlobal<T>(name: "site" | "navigation" | "home" | "product" | "imprint"): Promise<T> {
  if (!globals.has(name)) {
    const entry = await getEntry(name, name);
    if (!entry) throw new Error(`Missing Mica singleton: ${name}`);
    globals.set(name, entry.data);
  }
  return globals.get(name) as T;
}

export const getSite = () => getGlobal<SiteSettings>("site");
export const getNavigation = () => getGlobal<Navigation>("navigation");
export const getHome = () => getGlobal<Home>("home");
export const getProduct = () => getGlobal<Product>("product");
export const getImprint = () => getGlobal<Imprint>("imprint");

export async function getFeatures() {
  return [...(await getCollection("features"))].sort(
    (a, b) => a.data._mica.position - b.data._mica.position,
  );
}

/** The sections of the documentation, in the order the index and the sidebar show them. */
export const DOC_SECTIONS = [
  { key: "start", label: "Start here" },
  { key: "build", label: "Build" },
  { key: "edit", label: "Edit" },
  { key: "operate", label: "Operate" },
  { key: "reference", label: "Reference" },
] as const;

export async function getDocs() {
  return [...(await getCollection("docs"))].sort(
    (a, b) => a.data._mica.position - b.data._mica.position,
  );
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

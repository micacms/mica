import { getCollection, getEntry } from "astro:content";
import type { InferSingleton } from "@micacms/model";
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

export async function getDocs() {
  return [...(await getCollection("docs"))].sort(
    (a, b) => a.data._mica.position - b.data._mica.position,
  );
}

export async function getReleases() {
  return [...(await getCollection("releases"))].sort((a, b) =>
    b.data.publishDate.localeCompare(a.data.publishDate),
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

/**
 * What every website writes for its Mica content: a singleton with its type,
 * and a collection in the editor's order.
 */

import { localize as localizeFields, type Localize, type Site } from "@micacms/core/internal";

import type { SingletonDocument } from "./index.js";

/**
 * A singleton's data, typed by the site's model. Throws when it has no content
 * yet, so that the build names the singleton that an editor must fill in.
 */
export async function getSingleton<S extends Site, K extends keyof S["singletons"] & string>(
  site: S,
  name: K,
): Promise<SingletonDocument<S, K>> {
  const { getEntry } = await import("astro:content");
  const entry = await getEntry(name, name);
  if (!entry) throw new Error(`"${site.singletons[name]?.label ?? name}" has no content yet. Fill it in, in Mica.`);
  return entry.data as SingletonDocument<S, K>;
}

/** For `sort`: the order that the editor shows, `defaultSort` included. */
export const inEditorOrder = (a: { data: { _mica: { position: number } } }, b: { data: { _mica: { position: number } } }): number =>
  a.data._mica.position - b.data._mica.position;

/**
 * An entry's or a singleton's data in one locale, such as `Astro.currentLocale`: each localized field gives the value
 * of that locale, or the value that its fallback finds. Without a locale, the site's default locale.
 */
export function localize<S extends Site, T>(
  site: S,
  name: (keyof S["collections"] | keyof S["singletons"]) & string,
  data: T,
  locale?: string,
): Localize<T> {
  const def = site.collections[name] ?? site.singletons[name];
  if (!def) throw new Error(`"${name}" is not a collection or a singleton of the site.`);
  if (!site.defaultLocale) throw new Error("The site has no locales. Add `locales` to defineSite.");
  return localizeFields(site, def.fields, data, locale ?? site.defaultLocale);
}

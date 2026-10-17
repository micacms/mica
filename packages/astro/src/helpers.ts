/**
 * What every website writes for its Mica content: a singleton with its type,
 * and a collection in the editor's order.
 */

import type { Site } from "@micacms/core/internal";

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

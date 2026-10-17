/**
 * The maps of `coordinates({ map })`. The editor loads the style, and the
 * runtime allows its hosts in the editor's Content-Security-Policy. Mica never
 * fetches a style to find its hosts: the model names them.
 */

import type { FieldMap, MapPreset, MapStyle, Site } from "./types.js";

/** The OpenFreeMap styles that a field can name. */
export const MAP_PRESETS = ["liberty", "bright", "positron"] as const satisfies readonly MapPreset[];

/** The one host of the presets: style, tiles, glyphs and sprites. */
export const OPENFREEMAP_ORIGIN = "https://tiles.openfreemap.org";

/** A map as the editor loads it: the style address, and every origin that it can load from. */
export interface ResolvedMap {
  style: string;
  hosts: string[];
  /** The preset name, or null for a style of the site's own. */
  preset: MapPreset | null;
}

export function resolveMap(map: MapPreset | MapStyle): ResolvedMap {
  if (typeof map === "string") {
    return { style: `${OPENFREEMAP_ORIGIN}/styles/${map}`, hosts: [OPENFREEMAP_ORIGIN], preset: map };
  }
  const hosts = new Set([new URL(map.style).origin, ...(map.hosts ?? [])]);
  return { style: map.style, hosts: [...hosts], preset: null };
}

const httpsUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
};

/** Why a `map` option is not valid, or null when it is. */
export function mapProblem(map: unknown): string | null {
  if (typeof map === "string") {
    return (MAP_PRESETS as readonly string[]).includes(map) ? null : `use ${MAP_PRESETS.map((name) => `"${name}"`).join(", ")}, or { style, hosts }`;
  }
  if (map === null || typeof map !== "object" || Array.isArray(map)) return "use a preset name, or { style, hosts }";

  const { style, hosts } = map as { style?: unknown; hosts?: unknown };
  if (typeof style !== "string" || !httpsUrl(style)) return "the style must be an https address";
  if (hosts === undefined) return null;
  if (!Array.isArray(hosts)) return "hosts must be a list of https origins";
  for (const host of hosts) {
    const url = typeof host === "string" ? httpsUrl(host) : null;
    if (!url) return `the host ${JSON.stringify(host)} must be an https origin, such as "https://tiles.example.com"`;
    // An origin only: a CSP source with a path or a query would allow less, or something else, than the editor expects.
    if (url.origin !== host) return `the host "${host}" must be an origin, without a path: use "${url.origin}"`;
  }
  return null;
}

/** Every origin that the maps of the model load from, sorted. Empty when no field has a map. */
export function mapHosts(site: Site): string[] {
  const hosts = new Set<string>();
  const visit = (fields: FieldMap) => {
    for (const field of Object.values(fields)) {
      if (field.kind === "coordinates" && field.map !== undefined) for (const host of resolveMap(field.map).hosts) hosts.add(host);
      else if (field.kind === "object" || field.kind === "repeater") visit(field.fields);
    }
  };
  for (const def of [...Object.values(site.collections), ...Object.values(site.singletons)]) visit(def.fields);
  return [...hosts].sort();
}

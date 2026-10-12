/**
 * The protocol manifest this project publishes.
 *
 * Its own module rather than a function in `index.ts`, so that the integration
 * can emit a manifest without importing the loaders, and the loaders can be
 * imported without pulling in the integration. The two files would otherwise
 * import each other.
 */

import { createManifest, type ProtocolManifest, type Site } from "@micacms/core";

/**
 * Mica holds no model of its own. The Astro project is the only place a
 * collection is defined, and this is how it says so.
 */
export function manifestFor(site: Site): ProtocolManifest {
  return createManifest(site, "@micacms/astro");
}

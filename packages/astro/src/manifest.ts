/** The protocol manifest this project publishes; the loaders write it. */

import { createManifest, type ProtocolManifest, type Site } from "@micacms/core/internal";

/**
 * Mica holds no model of its own. The Astro project is the only place a
 * collection is defined, and this is how it says so.
 */
export function manifestFor(site: Site): ProtocolManifest {
  return createManifest(site, "@micacms/astro");
}

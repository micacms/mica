/**
 * Where the content root is, said once.
 *
 * The collections, the dev integration and the manifest writer all have to
 * agree on this directory, and a disagreement between them produces an empty
 * build rather than an error — the worst kind of failure. So the project states
 * it once, in `defineSite({ root })`, and everything here resolves that one
 * string the same way.
 *
 * Resolved against the **Astro project root**, not the working directory, which
 * is what Astro's own `glob({ base })` does. A relative root therefore means
 * the same thing whether the build was started from the project, from a
 * workspace root, or by an editor extension. Absolute paths are left alone, for
 * content that lives outside the project.
 */

import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_CONTENT_ROOT = "./content";

export function resolveContentRoot(root: string | undefined, projectRoot?: URL): string {
  const configured = root ?? DEFAULT_CONTENT_ROOT;

  if (isAbsolute(configured)) return configured;

  // Only outside a loader or a hook — a plain unit test, or an Astro version
  // that stops passing its config. The working directory is the best guess
  // left, and it is right whenever the build was started from the project.
  if (!projectRoot) return resolve(configured);

  // A base without a trailing slash would have its last segment replaced
  // rather than appended to. Astro's `config.root` has one; nothing else is
  // guaranteed to.
  const base = projectRoot.href.endsWith("/") ? projectRoot.href : `${projectRoot.href}/`;
  return fileURLToPath(new URL(configured, base));
}

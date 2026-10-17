/**
 * Files that are not images reach Astro as paths from the content root, as
 * the editor stored them. A page reads such a file at build time, for example
 * a GPX track, through `mediaFile`.
 */

import { join } from "node:path";

import { contentPath, type Site } from "@micacms/core/internal";

import { resolveContentRoot } from "./root.js";

/**
 * The file on disk for a media path, for a build that reads it. A relative
 * `defineSite({ root })` is resolved against the working directory, which is
 * the project when `astro build` or `astro dev` starts there. A `..` is refused.
 */
export function mediaFile(site: Pick<Site, "root">, path: string): string {
  return join(resolveContentRoot(site.root), contentPath(path));
}

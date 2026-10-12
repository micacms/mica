/**
 * What the managed workspace needs to know about content: which files belong
 * together, and whether a set of drafts may be published.
 *
 * A conflict is decided per group, never per file — an entry's `index.json`
 * from one side and its `.mdoc` from the other is a mixed entry that nobody
 * wrote. The groups are the change list's own (`classifyPath`), so a conflict
 * names the same thing the Publish page shows.
 */

import type { Site } from "@micacms/core";
import {
  analyseChanges,
  ApiError,
  classifyPath,
  describeProblems,
  flattenProblems,
  headSource,
  listTreeChanges,
  type ContentFiles,
  type GitTree,
} from "@micacms/runtime";

import type { ContentGroup } from "./managed.js";

export function contentGroups(model: Site): (path: string) => ContentGroup {
  return (path) => {
    const owner = classifyPath(model, path);
    switch (owner.kind) {
      case "entry":
        return {
          key: `entry:${owner.collection}/${owner.slug}`,
          label: owner.label,
          target: { kind: "entry", collection: owner.collection, slug: owner.slug },
        };
      case "singleton":
        return { key: `singleton:${owner.name}`, label: owner.label, target: { kind: "singleton", name: owner.name } };
      case "order":
        return { key: `order:${owner.collection}`, label: owner.label, target: { kind: "order", collection: owner.collection } };
      default:
        return { key: `file:${path}`, label: owner.label };
    }
  };
}

/**
 * Groups by the first path segment — a whole collection or singleton — for a
 * sync that has no readable model. Coarse on purpose: a group too large shows
 * more conflicts, never fewer.
 */
export function coarseGroups(path: string): ContentGroup {
  const key = path.split("/")[0]!.replace(/\.json$/, "");
  return { key: `path:${key}`, label: key };
}

/**
 * Validates the drafts at `paths` before a rejected publication is made
 * again on a newer base: the fast-forward may have changed what they refer
 * to. Throws the same `ApiError` a Publish would.
 */
export function revalidator(
  model: Site,
  files: ContentFiles,
  tree: GitTree,
): (paths: string[]) => Promise<void> {
  return async (paths) => {
    const wanted = new Set(paths);
    const changes = (await listTreeChanges(tree)).filter((change) => wanted.has(change.path));
    const { validation } = await analyseChanges(model, files, changes, headSource(tree));
    if (!validation.ok) {
      throw new ApiError("validation_failed", describeProblems(validation.problems), {
        issues: flattenProblems(validation.problems),
      });
    }
  };
}

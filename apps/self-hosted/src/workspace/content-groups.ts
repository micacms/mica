/**
 * Content groups for the managed workspace. A conflict is decided per group,
 * never per file: an `index.json` from one side and an `.mdoc` from the other
 * is an entry that nobody wrote. The groups match the Publish page.
 */

import { ownerOfPath, readOnlyParts, type Site } from "@micacms/core/internal";
import {
  ApiError,
  describeProblems,
  flattenProblems,
  groupOf,
  listTreeChanges,
  validateSelection,
  type ContentFiles,
  type GitTree,
} from "@micacms/runtime";

import type { ContentGroup } from "./managed.js";

export function contentGroups(model: Site): (path: string) => ContentGroup {
  return (path) => {
    const owner = ownerOfPath(model, path);
    const key = groupOf(owner, path);
    switch (owner.kind) {
      case "entry":
        return { key, label: owner.label, target: { kind: "entry", collection: owner.collection, slug: owner.slug } };
      case "singleton":
        return { key, label: owner.label, target: { kind: "singleton", name: owner.name } };
      case "order":
        return { key, label: owner.label, target: { kind: "order", collection: owner.collection } };
      default:
        return { key, label: owner.label };
    }
  };
}

/**
 * Groups by the first path segment when no model is readable. A large group
 * shows more conflicts, never fewer.
 */
export function coarseGroups(path: string): ContentGroup {
  const key = path.split("/")[0]!;
  return { key: `path:${key}`, label: key };
}

/**
 * Validates the drafts at `paths` before a rejected publication is made again
 * on a newer base, with the checks of Publish: against what the commit will
 * hold, with merge conflicts and the parts that this build cannot write.
 */
export function revalidator(
  model: Site,
  files: ContentFiles,
  tree: GitTree,
): (paths: string[]) => Promise<void> {
  const readOnly = readOnlyParts(model);
  return async (paths) => {
    const validation = await validateSelection({ model, files, tree, listed: await listTreeChanges(tree), paths, readOnly });
    if (!validation.ok) {
      throw new ApiError("validation_failed", describeProblems(validation.problems), {
        issues: flattenProblems(validation.problems),
      });
    }
  };
}

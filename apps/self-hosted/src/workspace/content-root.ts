/**
 * The content root in the repository: the directory with the `.mica/schema.json`
 * that the website's build writes. `MICA_CONTENT_PATH` names it only when there are several.
 */

import { MANIFEST_PATH } from "@micacms/core/internal";
import type { GitRunner } from "@micacms/runtime";

import { CloneRefusal } from "./clone.js";

/** The configured root, or the one directory at `ref` with a `.mica/schema.json`. */
export async function contentRootAt(git: GitRunner, ref: string, configured: string | null): Promise<string> {
  if (configured !== null) return configured;
  const files = (await git.run(["ls-tree", "-r", "-z", "--name-only", ref])).split("\0");
  const roots = files.filter((file) => file.endsWith(`/${MANIFEST_PATH}`)).map((file) => file.slice(0, -MANIFEST_PATH.length - 1));
  if (roots.length === 1) return roots[0]!;
  if (files.includes(MANIFEST_PATH)) {
    throw new CloneRefusal(
      `${MANIFEST_PATH} is at the top of the repository. The content root must be a directory in it, such as content/.`,
    );
  }
  if (roots.length === 0) {
    throw new CloneRefusal(
      `There is no ${MANIFEST_PATH} in the repository. Build the website once, and commit and push the content\n` +
        `  directory with its ${MANIFEST_PATH}.`,
    );
  }
  throw new CloneRefusal(
    `The repository has more than one content root: ${roots.join(", ")}.\n  Set MICA_CONTENT_PATH to the one that Mica edits.`,
  );
}

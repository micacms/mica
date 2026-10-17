/**
 * The staging service on a Git working tree. Save has already written the
 * files; Publish commits the reviewed paths.
 *
 *   - Every Git operation is limited to an explicit path set, so other work in
 *     the same checkout is never swept in.
 *   - Only the reviewed files are published, as the editor saw them. Drafts of
 *     other entries stay drafts.
 *   - When the push fails, the commit stays as `committed-pending-push`; a
 *     retry pushes and never commits again.
 */

import { stat } from "node:fs/promises";

import { MANIFEST_PATH, memorySource, type ContentSource, type PublishResult, type Site } from "@micacms/core/internal";
import { within } from "@micacms/core/node";

import { ApiError, badRequest, notFound } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { developerPolicy } from "../workspace/developer.js";
import type { ContentFiles } from "../workspace/files.js";
import { GitError } from "../workspace/git.js";
import { createWorkspaceLocks, type WorkspaceLocks } from "../workspace/locks.js";
import type { OwnerPolicy } from "../workspace/policy.js";
import {
  commitPaths,
  currentBranch,
  detachedHead,
  discardChange,
  headRevision,
  headSource,
  overlaySource,
  listTreeChanges,
  locateTree,
  publicationMessage,
  unpushedCommits,
  type GitTree,
  type TreeChange,
} from "../workspace/tree.js";
import {
  analyseChanges,
  classifyPath,
  compareSources,
  describeProblems,
  flattenProblems,
  type AnnotatedChange,
  type CompareTarget,
  type Comparison,
  type ContentStagingService,
  ownedByTarget,
  type PublishInput,
  type RepositoryInfo,
  type StagingStatus,
  type StagingValidation,
} from "./changes.js";

export interface WorkingTreeStagingDeps {
  model: Site;
  /**
   * The working tree's files without the lock wrapper: this service holds the
   * locks around whole operations.
   */
  files: ContentFiles;
  contentRoot: string;
  schemaRevision: string | null;
  /** From `readOnlyParts`: a change to one of these is never published by this build. */
  readOnly?: ReadonlyMap<string, string>;
  /** `MICA_LOCAL_PUBLISH`, for the default developer policy. */
  publishEnabled: boolean;
  logger: Logger;
  /** Defaults to the developer. */
  policy?: OwnerPolicy;
  /** Shared with the services that write content. */
  locks?: WorkspaceLocks;
  /**
   * Set by a managed clone, whose Git runs in an isolated environment. Without
   * it, the developer's Git finds the tree.
   */
  tree?: GitTree;
}

export function createWorkingTreeStagingService(
  deps: WorkingTreeStagingDeps,
): ContentStagingService {
  const { model, files, contentRoot, logger } = deps;
  const policy = deps.policy ?? developerPolicy({ publishEnabled: deps.publishEnabled, logger });
  const locks = deps.locks ?? createWorkspaceLocks();

  /** `source` is what the result holds: the whole working tree, or a selection of it. */
  const analyse = async (tree: GitTree, treeChanges: TreeChange[], source: ContentSource = files, validate = true) => {
    const { changes, validation } = await analyseChanges(model, source, treeChanges, headSource(tree), { validate });

    // The field validator cannot see a merge conflict: the file holds Git's conflict format.
    for (const change of treeChanges) {
      if (!change.conflicted) continue;
      validation.problems.push({
        path: change.path,
        label: change.path,
        issues: [
          { path: "", message: "This file has a Git merge conflict. Resolve it with your Git tools." },
        ],
      });
    }
    // By the first path segment, so that a stray file in a read-only collection is caught too.
    for (const change of changes) {
      const head = change.path.split("/")[0] ?? "";
      const reason = deps.readOnly?.get(`collections.${head}`) ?? deps.readOnly?.get(`singletons.${head}`);
      if (reason) {
        validation.problems.push({ path: change.path, label: change.owner.label, issues: [{ path: "", message: reason }] });
      }
    }
    validation.ok = validation.problems.length === 0;

    return { changes, validation };
  };

  const locate = async (): Promise<GitTree | { reason: string }> => deps.tree ?? locateTree(contentRoot);

  const located = async (): Promise<GitTree> => {
    const tree = await locate();
    if ("reason" in tree) throw badRequest(tree.reason);
    return tree;
  };

  const publishable = async (): Promise<GitTree> => {
    const availability = policy.publishAvailability();
    if (!availability.enabled) throw badRequest(availability.reason);
    return located();
  };

  /** The key that keeps an entry's files together: a publication never splits one. */
  const groupOf = (change: AnnotatedChange): string => {
    const owner = change.owner;
    if (owner.kind === "entry") return `entry:${owner.collection}/${owner.slug}`;
    if (owner.kind === "singleton") return `singleton:${owner.name}`;
    if (owner.kind === "order") return `order:${owner.collection}`;
    return `file:${change.path}`;
  };

  const withRevisions = async (changes: AnnotatedChange[]): Promise<AnnotatedChange[]> =>
    Promise.all(
      changes.map(async (change) => ({
        ...change,
        revision: change.kind === "delete" ? null : await files.revision(change.path),
      })),
    );

  /**
   * The review check of Publish and Discard: the reviewed paths whose file was
   * saved again or is no longer pending, and the other pending files of a
   * reviewed group. Drafts of other groups never block.
   */
  const unreviewed = (pending: AnnotatedChange[], reviewed: Record<string, string | null>): string[] => {
    const byPath = new Map(pending.map((change) => [change.path, change]));
    const groups = new Set(
      Object.keys(reviewed).flatMap((path) => {
        const change = byPath.get(path);
        return change ? [groupOf(change)] : [];
      }),
    );
    return [
      ...Object.keys(reviewed).filter((path) => !byPath.has(path) || byPath.get(path)!.revision !== reviewed[path]),
      ...pending.filter((change) => groups.has(groupOf(change)) && !(change.path in reviewed)).map((change) => change.path),
    ];
  };

  /** When each file was last saved; a deletion has no file to ask. */
  const withSavedAt = async (changes: AnnotatedChange[]): Promise<AnnotatedChange[]> =>
    Promise.all(
      changes.map(async (change) => {
        if (change.kind === "delete") return { ...change, savedAt: null };
        const saved = await stat(within(contentRoot, change.path)).catch(() => null);
        return { ...change, savedAt: saved ? saved.mtime.toISOString() : null };
      }),
    );

  /** Refused for the developer's checkout: Mica never fetches or merges there. */
  const managedOnly = <T>(action: T | undefined): T => {
    if (action === undefined) throw notFound("Only a self-hosted Mica keeps its own copy of the website; the local editor leaves Git to you.");
    return action;
  };

  return {
    async status(): Promise<StagingStatus> {
      const tree = await locate();
      const sync = policy.syncStatus?.() ?? null;

      if ("reason" in tree) {
        return {
          owner: policy.owner,
          publish: { enabled: false, reason: tree.reason },
          head: null,
          branch: null,
          unpushed: null,
          detached: null,
          changes: [],
          validation: emptyValidation(),
          sync,
        };
      }

      const { changes, validation, head, branch } = await locks.tree.read(async () => {
        const analysed = await analyse(tree, await listTreeChanges(tree));
        return {
          ...analysed,
          changes: await withSavedAt(await withRevisions(analysed.changes)),
          head: await headRevision(tree),
          branch: await currentBranch(tree),
        };
      });

      // A clone that Mica keeps is always on its branch.
      const detached = policy.owner === "developer" ? await detachedHead(tree) : null;

      return {
        owner: policy.owner,
        publish: policy.publishAvailability(),
        head,
        // Git names a detached HEAD "HEAD", which is no branch.
        branch: detached ? null : branch,
        // A clone that Mica keeps holds only Mica's commits, and retries its own push.
        unpushed: policy.owner === "developer" ? await unpushedCommits(tree) : null,
        detached,
        changes,
        validation,
        sync,
      };
    },

    async publish(input: PublishInput): Promise<PublishResult> {
      const message = input.message.trim();
      if (!message) throw badRequest("Say what changed before you publish.");
      const reviewed = Object.keys(input.paths);
      if (reviewed.length === 0) throw badRequest("Choose at least one change to publish.");

      const tree = await publishable();

      // One publication at a time from sync to push: no sync can run in
      // between, and no second commit can stack up.
      return locks.remote.run(async () => {
        await policy.prepare(tree);

        const revision = await locks.tree.write(async () => {
          const listed = await listTreeChanges(tree);
          const pending = await withRevisions((await analyse(tree, listed, files, false)).changes);
          if (unreviewed(pending, input.paths).length > 0) {
            throw new ApiError(
              "conflict",
              "Some of these changes were edited after you reviewed them. Review them again, then publish.",
            );
          }

          // The model drift gate: validation used the model that this process started with.
          if ((await files.revision(MANIFEST_PATH)) !== deps.schemaRevision) {
            throw new ApiError(
              "conflict",
              "The content model changed just now. Review the changes again, then publish.",
            );
          }

          const selected = listed.filter((change) => change.path in input.paths);
          // Checked against what the commit will hold: the working tree, with the drafts left behind as
          // HEAD has them. Every other file is the same in both, and the working tree is fast to read.
          const behind = listed.filter((change) => !(change.path in input.paths)).map((change) => change.path);
          const result = overlaySource(files, headSource(tree), behind);
          const { validation } = await analyse(tree, selected, result);
          if (!validation.ok) {
            throw new ApiError("validation_failed", describeProblems(validation.problems), {
              issues: flattenProblems(validation.problems),
            });
          }

          try {
            const revision = await commitPaths(tree, reviewed, publicationMessage(message), policy.commitAuthor(input.author));
            logger.info("Published", { revision, files: reviewed.length, owner: policy.owner, editor: input.editor });
            return revision;
          } catch (error) {
            if (error instanceof GitError) {
              // Git's message is the actionable part: no identity, a hook that
              // refused, a rebase in progress.
              throw new ApiError("conflict", `Publishing failed: ${error.message}`);
            }
            throw error;
          }
        });

        return policy.push(tree, revision);
      });
    },

    async push(): Promise<PublishResult> {
      const tree = await publishable();

      return locks.remote.run(async () => {
        const revision = await headRevision(tree);
        if (revision === null) throw badRequest("There is nothing to send to the website yet.");
        return policy.push(tree, revision);
      });
    },

    async discard(reviewed: Record<string, string | null>, editor?: string): Promise<{ discarded: string[] }> {
      const tree = await located();

      return locks.tree.write(async () => {
        const listed = await listTreeChanges(tree);
        // A discarded draft cannot come back, so it takes the review check of Publish.
        if (unreviewed(await withRevisions((await analyse(tree, listed, files, false)).changes), reviewed).length > 0) {
          throw new ApiError("conflict", "Some of these changes were edited after you reviewed them. Review them again, then discard.");
        }
        const current = new Map(listed.map((change) => [change.path, change]));

        const discarded: string[] = [];
        for (const path of Object.keys(reviewed)) {
          const change = current.get(path);
          if (!change) continue;
          await discardChange(tree, change);
          discarded.push(path);
        }

        if (discarded.length > 0) logger.info("Discarded", { paths: discarded, editor });
        return { discarded };
      });
    },

    async compare(target: CompareTarget, against: "head" | "origin" = "head"): Promise<Comparison> {
      const tree = await locate();
      if (against === "origin" && !policy.upstreamRef) throw badRequest("There is no website version to compare with here.");
      // Without a repository nothing is published, so "before" is an empty source.
      const published =
        "reason" in tree
          ? memorySource({}, "unpublished")
          : headSource(tree, against === "origin" ? policy.upstreamRef : "HEAD");
      return locks.tree.read(async () => {
        // The revisions before the content: a revision is never newer than what the editor sees.
        const revisions: Record<string, string | null> = {};
        if (!("reason" in tree) && against === "head") {
          for (const change of await listTreeChanges(tree)) {
            if (!ownedByTarget(classifyPath(model, change.path), target)) continue;
            revisions[change.path] = change.kind === "delete" ? null : await files.revision(change.path);
          }
        }
        return { ...(await compareSources(model, published, files, target)), revisions };
      });
    },

    async sync(): Promise<void> {
      await managedOnly(policy.sync)();
    },

    async resolve(group: string, choice: "mine" | "website", editor?: string): Promise<void> {
      await managedOnly(policy.resolve)(group, choice);
      logger.info("Conflict resolved", { group, choice, editor });
    },

    async repository(): Promise<RepositoryInfo> {
      const tree = await locate();
      const described = (await policy.describe?.()) ?? null;
      return {
        owner: policy.owner,
        branch: "reason" in tree ? null : await currentBranch(tree),
        head: "reason" in tree ? null : await headRevision(tree),
        url: described?.url ?? null,
        cloneBytes: described?.cloneBytes ?? null,
        sync: policy.syncStatus?.() ?? null,
      };
    },
  };
}

function emptyValidation(): StagingValidation {
  return { ok: true, problems: [] };
}

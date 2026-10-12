/**
 * The managed owner policy: a clone that Mica keeps up to date by itself.
 *
 * Sync never merges. It fetches, pushes a pending publication, downloads the
 * blobs the fast-forward will need (outside the tree lock), and fast-forwards
 * only when no entry that an editor changed was also changed upstream. Mica
 * finds those conflicts itself, per entry group, before it asks Git to move:
 * Git's own refusal misses an untracked draft in some cases and never sees
 * that a local deletion undoes an upstream edit. An editor resolves a
 * conflict by keeping their version or by taking the website's.
 *
 * A publication is pushed with an explicit refspec and never forced. A push
 * the remote rejects as non-fast-forward is undone, the clone is brought up
 * to date, and the same commit is made again on top; a push the host refuses
 * outright turns back into drafts. See decisions.md, "Sync never merges" and
 * "Publish: the reviewed paths, at most one unpushed commit".
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Author, PublishResult } from "@micacms/core";
import {
  ApiError,
  GitError,
  recommitPaths,
  type GitRunner,
  type GitTree,
  type Logger,
  type OwnerPolicy,
  type PublishAvailability,
  type WorkspaceLocks,
} from "@micacms/runtime";

import { lfsRefusal, writeBackKept, writeMarker, type CloneLayout } from "./clone.js";
import { redact } from "./credentials.js";
import { classifyFailure, describeFailure, readPush, type FailureClass, type PushOutcome } from "./failures.js";
import { MICA_IDENTITY } from "./isolation.js";
import { lfsUnderRoot } from "./lfs.js";
import { changedBetween, draftPaths, restorePaths } from "./restore.js";

/** The editor's name for a piece of content, and the key that groups its files. */
export interface ContentGroup {
  key: string;
  label: string;
}

export interface ConflictGroup extends ContentGroup {
  /** Content-relative paths of the group that are drafts or changed upstream. */
  paths: string[];
  upstream: "changed" | "deleted" | "added";
}

export interface SyncProblem {
  code: FailureClass | "prefetch_incomplete" | "fast_forward_failed";
  message: string;
  since: string;
}

export interface SyncState {
  head: string | null;
  /** When a sync last reached the remote. */
  lastSyncAt: string | null;
  /** Upstream commits not yet in the clone. */
  behind: number;
  /** Upstream changed the content model or `.gitattributes`; a restart applies it. */
  restartRequired: boolean;
  conflicts: ConflictGroup[];
  pendingPush: { revision: string; reason: string } | null;
  /** The last publication the host refused, turned back into drafts. */
  refused: { reason: string; at: string } | null;
  error: SyncProblem | null;
}

export interface ManagedWorkspaceOptions {
  layout: CloneLayout;
  git: GitRunner;
  tree: GitTree;
  branch: string;
  /** Content root, repository-relative. */
  root: string;
  locks: WorkspaceLocks;
  logger: Logger;
  /** The groups an editor sees: an entry with its files, a singleton, an order. */
  groupOf(contentPath: string): ContentGroup;
  /** Checks the drafts again before a rejected publication is made again. Throws an `ApiError`. */
  revalidate?(contentPaths: string[]): Promise<void>;
  /** Removed from every message that leaves this module. */
  secrets?: string[];
  syncSeconds: number;
}

export interface ManagedWorkspace {
  policy: OwnerPolicy;
  state(): SyncState;
  /** At start, `skipHold` lets the fast-forward apply a model change — the model is read after it. */
  sync(options?: { skipHold?: boolean }): Promise<SyncState>;
  resolve(group: string, choice: "mine" | "website"): Promise<SyncState>;
  /** Whether the remote would accept a push: proves authentication and push rights, not branch rules. */
  checkWrite(): Promise<PushOutcome>;
  start(): void;
  stop(): void;
}

class RemoteFailure extends Error {
  constructor(
    readonly code: SyncProblem["code"],
    message: string,
  ) {
    super(message);
  }
}

const MAX_PUSH_TRIES = 3;

export function createManagedWorkspace(options: ManagedWorkspaceOptions): ManagedWorkspace {
  const { git, layout, locks, logger, branch, root } = options;
  const upstreamRef = `origin/${branch}`;
  const clean = (text: string) => redact(text, options.secrets ?? []);

  const state: SyncState = {
    head: null,
    lastSyncAt: null,
    behind: 0,
    restartRequired: false,
    conflicts: [],
    pendingPush: null,
    refused: null,
    error: null,
  };
  /** Groups whose editor chose "Keep my version"; applied at the next fast-forward. */
  const kept = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  /* ------------------------------------------------------------ paths */

  const underRoot = (path: string) => root === "" || path.startsWith(`${root}/`);
  const contentPath = (path: string) => (root === "" ? path : path.slice(root.length + 1));
  const groupKey = (path: string) => options.groupOf(contentPath(path)).key;
  const manifestPath = root === "" ? ".mica/schema.json" : `${root}/.mica/schema.json`;

  /** A `.gitattributes` that can apply under the root: in it, below it, or in an ancestor. */
  const attributesForRoot = (path: string) => {
    if (path !== ".gitattributes" && !path.endsWith("/.gitattributes")) return false;
    const dir = path === ".gitattributes" ? "" : dirname(path);
    return underRoot(path) || dir === "" || root === dir || root.startsWith(`${dir}/`);
  };

  /* ----------------------------------------------------------- remote */

  const fetch = async () => {
    try {
      await git.run(["fetch", "--quiet", "--no-tags", "origin"]);
    } catch (error) {
      throw remoteFailure(error);
    }
    // gc is off for every other call (`isolation.ts`); here, under the remote
    // lock and outside the tree lock, it may run.
    await git.tryRun(["-c", "gc.auto=6700", "gc", "--auto", "--quiet"]);
  };

  const remoteFailure = (error: unknown): RemoteFailure => {
    const stderr = error instanceof GitError ? error.stderr : String(error);
    const code = classifyFailure(stderr);
    return new RemoteFailure(code, `${describeFailure(code)} ${clean(firstLines(stderr))}`.trim());
  };

  const ahead = async () => Number((await git.tryRun(["rev-list", "--count", `${upstreamRef}..HEAD`])) ?? "0");

  /* ------------------------------------------------------ fast-forward */

  /**
   * Brings the clone to the upstream head, or reports why not. The caller
   * holds the remote lock. Network access happens before the tree lock: the
   * prefetch downloads every blob the fast-forward will write.
   */
  const fastForward = async (skipHold: boolean): Promise<void> => {
    const from = await git.run(["rev-parse", "HEAD"]);
    const to = await git.run(["rev-parse", upstreamRef]);
    state.head = from;

    // At start, LFS is checked even when nothing moved: the clone may be older
    // than the attributes that brought LFS in.
    if (skipHold) {
      const lfs = await lfsUnderRoot(git, to, root);
      if (lfs) throw lfsRefusal(lfs, root);
    }

    if (from === to) {
      state.behind = 0;
      state.conflicts = [];
      return;
    }
    if ((await git.tryRun(["merge-base", "--is-ancestor", "HEAD", upstreamRef])) === null) {
      // A publication not yet pushed sits on HEAD; the push loop re-makes it.
      return;
    }

    await git.run(["diff", "--numstat", from, to]);
    const missing = (await git.run(["rev-list", "--objects", "--missing=print", `${from}..${to}`], {
      env: { GIT_NO_LAZY_FETCH: "1" },
    }))
      .split("\n")
      .filter((line) => line.startsWith("?"));
    if (missing.length > 0) {
      throw new RemoteFailure("prefetch_incomplete", `${missing.length} objects could not be downloaded.`);
    }

    state.behind = Number(await git.run(["rev-list", "--count", `${from}..${to}`]));
    const upstream = await changedBetween(git, from, to);

    if (!skipHold && upstream.some((path) => path === manifestPath || attributesForRoot(path))) {
      // Saves go on with the loaded model; the restart fast-forwards and then
      // reads the new one. A save with the old model would drop new fields.
      if (!state.restartRequired) logger.warn("The content model changed upstream; a restart applies it", { to });
      state.restartRequired = true;
      return;
    }

    await locks.tree.write(async () => {
      const drafts = await draftPaths(git, root);
      const upstreamInRoot = upstream.filter(underRoot);
      const draftGroups = new Set(drafts.map(groupKey));
      const upstreamGroups = new Set(upstreamInRoot.map(groupKey));

      const conflicting = [...upstreamGroups].filter((key) => draftGroups.has(key) && !kept.has(key));
      if (conflicting.length > 0) {
        state.conflicts = await describeConflicts(conflicting, drafts, upstreamInRoot, from, to);
        return;
      }

      // "Keep my version": put the group's drafts aside, let the upstream
      // version in, and write the drafts back on top.
      const keeping = [...kept].filter((key) => upstreamGroups.has(key) && draftGroups.has(key));
      const keptPaths = drafts.filter((path) => keeping.includes(groupKey(path)));
      if (keptPaths.length > 0) {
        await rescue(keptPaths);
        await restorePaths(git, layout.repositoryDir, "HEAD", keptPaths);
      }

      await writeMarker(layout.operationFile, { from, to });
      try {
        await git.run(["merge", "--ff-only", "--quiet", to], { env: { GIT_NO_LAZY_FETCH: "1" } });
      } catch (error) {
        // A fast-forward that fails during the checkout has already changed
        // files. Put every upstream path back the way `from` has it.
        await restorePaths(git, layout.repositoryDir, from, upstream);
        if ((await git.run(["rev-parse", "HEAD"])) !== from) {
          await git.run(["update-ref", `refs/heads/${branch}`, from]);
        }
        await rm(layout.operationFile, { force: true });
        await writeBackKept(layout);
        const stderr = error instanceof GitError ? error.stderr : String(error);
        throw new RemoteFailure("fast_forward_failed", clean(firstLines(stderr)) || "Git could not fast-forward.");
      }
      await rm(layout.operationFile, { force: true });
      await writeBackKept(layout);

      for (const key of keeping) kept.delete(key);
      state.conflicts = [];
      state.behind = 0;
      state.head = to;
      logger.info("Brought the clone up to date", { from, to, files: upstream.length });
    });
  };

  const describeConflicts = async (
    keys: string[],
    drafts: string[],
    upstream: string[],
    from: string,
    to: string,
  ): Promise<ConflictGroup[]> => {
    const status = new Map<string, string>();
    const raw = await git.run(["diff", "--no-renames", "--name-status", "-z", from, to, "--", root || "."]);
    const fields = raw.split("\0").filter(Boolean);
    for (let at = 0; at + 1 < fields.length; at += 2) status.set(fields[at + 1]!, fields[at]!);

    return keys.map((key) => {
      const ups = upstream.filter((path) => groupKey(path) === key);
      const kinds = new Set(ups.map((path) => status.get(path)));
      const paths = [...new Set([...drafts.filter((path) => groupKey(path) === key), ...ups])].map(contentPath);
      const { label } = options.groupOf(paths[0]!);
      return {
        key,
        label,
        paths,
        upstream: kinds.size === 1 && kinds.has("D") ? "deleted" : kinds.size === 1 && kinds.has("A") ? "added" : "changed",
      };
    });
  };

  /** Copies drafts to the rescue directory, then writes the marker last. */
  const rescue = async (paths: string[]) => {
    await rm(layout.rescueDir, { recursive: true, force: true });
    await mkdir(layout.rescueDir, { recursive: true });
    const files: Record<string, string | null> = {};
    let index = 0;
    for (const path of paths) {
      const bytes = await readFile(join(layout.repositoryDir, path)).catch(() => null);
      if (bytes === null) {
        files[path] = null;
        continue;
      }
      const copy = String(index++);
      await writeFile(join(layout.rescueDir, copy), bytes);
      files[path] = copy;
    }
    await writeMarker(layout.keepMineFile, { files });
  };

  /* ------------------------------------------------------------- push */

  /**
   * Pushes HEAD. The caller holds the remote lock. Returns the outcome an
   * editor sees, or throws an `ApiError` when the publication turned back
   * into drafts.
   */
  const push = async (): Promise<PublishResult> => {
    for (let attempt = 1; ; attempt += 1) {
      const revision = await git.run(["rev-parse", "HEAD"]);
      const outcome = await pushOnce(["push", "--porcelain", "origin", `HEAD:refs/heads/${branch}`]);

      if (outcome.kind === "pushed") {
        state.pendingPush = null;
        state.refused = null;
        logger.info("Pushed a publication", { revision });
        return { state: "published", revision };
      }

      if (outcome.kind === "remote-rejected" || (outcome.kind === "failed" && outcome.failure === "write_forbidden")) {
        const reason =
          outcome.kind === "remote-rejected" ? clean(outcome.reason) : describeFailure("write_forbidden");
        await undoPublication();
        state.pendingPush = null;
        state.refused = { reason, at: new Date().toISOString() };
        logger.warn("The repository refused a publication; it is a draft again", { revision, reason });
        throw new ApiError(
          "conflict",
          "The repository refused this publication. It is a draft again. Tell the person who runs Mica.",
        );
      }

      if (outcome.kind === "failed" || attempt >= MAX_PUSH_TRIES) {
        const reason = outcome.kind === "failed" ? describeFailure(outcome.failure) : "The remote kept moving.";
        if (state.pendingPush?.reason !== reason) {
          logger.warn("A publication is committed but not pushed yet", { revision, reason });
        }
        state.pendingPush = { revision, reason };
        return { state: "committed-pending-push", revision, pushError: reason };
      }

      // Non-fast-forward: undo the commit, catch up, and make it again.
      const original = revision;
      const paths = (await git.run(["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", "HEAD"]))
        .split("\0")
        .filter(Boolean)
        .filter(underRoot)
        .map(contentPath);
      await undoPublication();
      await fetch();
      await fastForward(false);
      if (state.restartRequired || state.conflicts.length > 0) {
        throw new ApiError(
          "conflict",
          state.restartRequired
            ? "The content model changed on the website. Ask the person who runs Mica to restart it, then publish again."
            : "The website changed some of these entries while you published. Resolve the conflicts, then publish again.",
        );
      }
      await options.revalidate?.(paths);
      await locks.tree.write(() => recommitPaths(options.tree, paths, original));
    }
  };

  const pushOnce = async (args: string[]): Promise<PushOutcome> => {
    try {
      const stdout = await git.run(args);
      return readPush(0, stdout, "");
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      return readPush(error.exitCode, error.stdout, error.stderr);
    }
  };

  /** Turns the one unpushed commit back into staged drafts. */
  const undoPublication = async () => {
    if ((await ahead()) !== 1) {
      throw new ApiError("conflict", "The clone has an unexpected number of unpushed commits. Nothing was changed.");
    }
    await locks.tree.write(() => git.run(["reset", "--soft", "HEAD^"]));
  };

  /* ------------------------------------------------------------- sync */

  const sync = (syncOptions: { skipHold?: boolean } = {}): Promise<SyncState> =>
    locks.remote.run(async () => {
      try {
        await fetch();
        if ((await ahead()) > 0) {
          await push().catch((error: unknown) => {
            // The refusal is recorded in the state; the sync goes on.
            if (!(error instanceof ApiError)) throw error;
          });
        }
        await fastForward(syncOptions.skipHold ?? false);
        if (state.error) logger.info("The repository is reachable again");
        state.error = null;
        state.lastSyncAt = new Date().toISOString();
      } catch (error) {
        if (!(error instanceof RemoteFailure)) throw error;
        if (state.error?.code !== error.code) {
          logger.warn("Sync failed", { code: error.code, message: error.message });
          state.error = { code: error.code, message: error.message, since: new Date().toISOString() };
        }
      }
      return snapshot();
    });

  const snapshot = (): SyncState => ({ ...state, conflicts: [...state.conflicts] });

  /* ----------------------------------------------------------- policy */

  const policy: OwnerPolicy = {
    owner: "managed",

    publishAvailability(): PublishAvailability {
      if (state.restartRequired) {
        return {
          enabled: false,
          reason: "The content model changed on the website. Ask the person who runs Mica to restart it.",
        };
      }
      if (state.conflicts.length > 0) {
        return { enabled: false, reason: "Some entries were changed on the website while you edited them." };
      }
      return { enabled: true };
    },

    async prepare() {
      await sync();
      const availability = policy.publishAvailability();
      if (!availability.enabled) throw new ApiError("conflict", availability.reason);
      if (state.pendingPush) {
        throw new ApiError(
          "conflict",
          "An earlier publication has not reached the repository yet. Mica tries again every minute.",
        );
      }
    },

    commitAuthor: (editor: Author | undefined) => editor ?? MICA_IDENTITY,

    // The staging service holds the remote lock around this call.
    push: () => push(),
  };

  return {
    policy,
    state: snapshot,
    sync,

    async resolve(group, choice) {
      if (choice === "mine") {
        kept.add(group);
      } else {
        kept.delete(group);
        await locks.tree.write(async () => {
          const paths = (await draftPaths(git, root)).filter((path) => groupKey(path) === group);
          await restorePaths(git, layout.repositoryDir, "HEAD", paths);
        });
      }
      logger.info("Resolved a conflict", { group, choice });
      return sync();
    },

    checkWrite: () =>
      locks.remote.run(() => pushOnce(["push", "--dry-run", "--porcelain", "origin", `HEAD:refs/heads/${branch}`])),

    start() {
      if (timer) return;
      timer = setInterval(() => {
        void sync().catch((error: unknown) => logger.error("Sync crashed", { error: String(error) }));
      }, options.syncSeconds * 1000);
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

function firstLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, 3)
    .join(" ");
}

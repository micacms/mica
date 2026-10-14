/**
 * The managed owner policy: a clone that Mica keeps up to date. Sync never
 * merges; it fast-forwards only when no group that an editor changed also
 * changed upstream. Mica finds conflicts itself, because Git's refusal misses
 * some untracked drafts and never sees that a local deletion undoes an upstream
 * edit. A push is never forced.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { PublishResult } from "@micacms/core";
import {
  ApiError,
  type Author,
  GitError,
  recommitPaths,
  type GitRunner,
  type GitTree,
  type Logger,
  type OwnerPolicy,
  type PublishAvailability,
  type SyncConflict,
  type SyncStatus,
  type WorkspaceLocks,
} from "@micacms/runtime";

import { CloneRefusal, lfsRefusal, writeBackKept, writeMarker, type CloneLayout } from "./clone.js";
import { redact } from "./credentials.js";
import { classifyFailure, describeFailure, readPush, type FailureClass, type PushOutcome } from "./failures.js";
import { MICA_IDENTITY } from "./isolation.js";
import { attributesPlace, lfsUnderRoot } from "./lfs.js";
import { changedBetween, draftPaths, restorePaths } from "./restore.js";

/** The editor's name for a piece of content, and the key that groups its files. */
export interface ContentGroup {
  key: string;
  label: string;
  /** What a comparison shows, when the group is one document. */
  target?: SyncConflict["target"];
}

export interface ConflictGroup extends ContentGroup {
  /** Content-relative paths of the group that are drafts or changed upstream. */
  paths: string[];
  upstream: "changed" | "deleted" | "added";
}

export interface SyncProblem {
  code: FailureClass | "prefetch_incomplete" | "fast_forward_failed" | "diverged";
  message: string;
  since: string;
}

export interface SyncState {
  head: string | null;
  /** When a sync last reached the remote. */
  lastSyncAt: string | null;
  /** Upstream commits not yet in the clone. */
  behind: number;
  /** Upstream changed `.gitattributes`; a restart applies it. A new content model needs none. */
  restartRequired: boolean;
  conflicts: ConflictGroup[];
  pendingPush: { revision: string; reason: string } | null;
  /** The last publication the host refused, turned back into drafts. */
  refused: { reason: string; at: string } | null;
  error: SyncProblem | null;
  /**
   * Why the clone takes no saves and no syncs until a restart: a fast-forward
   * failed and could not be undone. The start finishes it (`recover`).
   */
  readOnly: string | null;
}

export interface ManagedWorkspaceOptions {
  layout: CloneLayout;
  url: string;
  git: GitRunner;
  tree: GitTree;
  branch: string;
  root: string;
  locks: WorkspaceLocks;
  logger: Logger;
  groupOf(contentPath: string): ContentGroup;
  /** Checks the drafts again before a rejected publication is made again. Throws an `ApiError`. */
  revalidate?(contentPaths: string[]): Promise<void>;
  /** Removed from every message that leaves this module. */
  secrets?: string[];
  syncSeconds: number;
  /** After a fast-forward brought a new content model: the app uses it at once. */
  onModelChange?(): Promise<void>;
}

export interface ManagedWorkspace {
  policy: OwnerPolicy;
  state(): SyncState;
  /**
   * At start, `skipHold` lets the fast-forward apply a model change; the model
   * is read after it.
   */
  sync(options?: { skipHold?: boolean }): Promise<SyncState>;
  resolve(group: string, choice: "mine" | "website"): Promise<SyncState>;
  /**
   * Whether the remote would accept a push: proves authentication and push
   * rights, not branch rules.
   */
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

/** Failures that a successful fetch ends. */
const REACHABILITY = new Set<SyncProblem["code"]>(["auth", "network", "repo_not_found", "branch_not_found", "unknown"]);

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
    readOnly: null,
  };
  /** Groups whose editor chose "Keep my version"; applied at the next fast-forward. */
  const kept = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const underRoot = (path: string) => root === "" || path.startsWith(`${root}/`);
  const contentPath = (path: string) => (root === "" ? path : path.slice(root.length + 1));
  const groupKey = (path: string) => options.groupOf(contentPath(path)).key;
  const manifestPath = root === "" ? ".mica/schema.json" : `${root}/.mica/schema.json`;

  const fetch = async () => {
    try {
      await git.run(["fetch", "--quiet", "--no-tags", "origin"]);
    } catch (error) {
      throw remoteFailure(error);
    }
    // gc is off for every other call (`isolation.ts`); here it runs outside the tree lock.
    await git.tryRun(["-c", "gc.auto=6700", "gc", "--auto", "--quiet"]);
  };

  const remoteFailure = (error: unknown): RemoteFailure => {
    const stderr = error instanceof GitError ? error.stderr : String(error);
    const code = classifyFailure(stderr);
    return new RemoteFailure(code, `${describeFailure(code)} ${clean(firstLines(stderr))}`.trim());
  };

  const ahead = async () => Number((await git.tryRun(["rev-list", "--count", `${upstreamRef}..HEAD`])) ?? "0");

  /**
   * Whether HEAD is one unpushed publication of Mica's: one commit ahead,
   * committed by Mica, on a base the branch still contains. Anything else ahead
   * means the branch was rewritten; pushing it or making drafts would undo
   * that.
   */
  const pendingPublication = async (): Promise<boolean> => {
    if ((await ahead()) !== 1) return false;
    if ((await git.run(["log", "-1", "--format=%ce", "HEAD"])) !== MICA_IDENTITY.email) return false;
    if ((await git.tryRun(["merge-base", "--is-ancestor", "HEAD^", upstreamRef])) === null) return false;
    // A publication in the tracking branch's reflog was pushed once and then
    // taken back by a force push.
    const head = await git.run(["rev-parse", "HEAD"]);
    const known = await git.tryRun(["reflog", "show", "--format=%H", `refs/remotes/${upstreamRef}`]);
    return !(known ?? "").split("\n").includes(head);
  };

  const diverged = () =>
    new RemoteFailure(
      "diverged",
      "The branch was rewritten in the repository (a force push or a reset), and Mica's clone no longer " +
        "follows it. Copy any drafts out of the clone, delete MICA_DATA_DIR/repository and restart Mica.",
    );

  /** The caller holds the remote lock. All network access happens before the tree lock is taken. */
  const fastForward = async (skipHold: boolean): Promise<void> => {
    const from = await git.run(["rev-parse", "HEAD"]);
    const to = await git.run(["rev-parse", upstreamRef]);
    state.head = from;

    // At start, LFS is checked even when nothing moved: the clone may be older
    // than the attributes that added LFS.
    if (skipHold) {
      state.restartRequired = false;
      const lfs = await lfsUnderRoot(git, to, root);
      if (lfs) throw lfsRefusal(lfs, root);
    }

    if (from === to) {
      state.behind = 0;
      state.conflicts = [];
      return;
    }
    if ((await git.tryRun(["merge-base", "--is-ancestor", "HEAD", upstreamRef])) === null) {
      // The push loop makes Mica's unpushed publication again on top.
      if (await pendingPublication()) return;
      throw diverged();
    }

    // Download every blob the fast-forward will write, then make sure they all
    // arrived: the fast-forward must not need the network. Only the new side
    // counts.
    await git.run(["diff", "--numstat", from, to]);
    // `-z --no-renames` gives pairs of metadata and path, so a path that starts
    // with ":" is still a path.
    const fields = (await git.run(["diff", "--raw", "-z", "--no-renames", "--no-abbrev", from, to])).split("\0");
    const written: string[] = [];
    for (let at = 0; at + 1 < fields.length; at += 2) {
      const [, mode, , object] = fields[at]!.slice(1).split(" ");
      if (mode !== "000000" && mode !== "160000" && object && !/^0+$/.test(object)) written.push(object);
    }
    if (written.length > 0) {
      const checked = await git.run(["cat-file", "--batch-check"], {
        input: `${written.join("\n")}\n`,
        env: { GIT_NO_LAZY_FETCH: "1" },
      });
      const missing = checked.split("\n").filter((line) => line.endsWith(" missing"));
      if (missing.length > 0) {
        throw new RemoteFailure("prefetch_incomplete", `${missing.length} files could not be downloaded.`);
      }
    }

    state.behind = Number(await git.run(["rev-list", "--count", `${from}..${to}`]));
    const upstream = await changedBetween(git, from, to);

    if (!skipHold && upstream.some((path) => attributesPlace(path, root) !== null)) {
      // Hold the fast-forward: the LFS check runs at start.
      if (!state.restartRequired) logger.warn("The Git attributes changed upstream; a restart applies them", { to });
      state.restartRequired = true;
      return;
    }
    const modelChanged = upstream.includes(manifestPath);

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

      // "Keep my version": put the drafts aside, let the upstream version in,
      // and write the drafts back on top.
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
        // A fast-forward that fails during the checkout has already changed files.
        try {
          await restorePaths(git, layout.repositoryDir, from, upstream);
          if ((await git.run(["rev-parse", "HEAD"])) !== from) {
            await git.run(["update-ref", `refs/heads/${branch}`, from]);
          }
          await rm(layout.operationFile, { force: true });
          await writeBackKept(layout);
        } catch (rollback) {
          // The clone is between two versions. The marker stays, so the next start
          // finishes the fast-forward; a save before that could be overwritten.
          state.readOnly =
            "Mica could not finish bringing its copy of the website up to date. Saving and publishing wait " +
            "until the person who runs Mica restarts it.";
          logger.error("A fast-forward failed and could not be undone; read-only until a restart", {
            error: clean(String(rollback)),
          });
        }
        const stderr = error instanceof GitError ? error.stderr : String(error);
        throw new RemoteFailure("fast_forward_failed", clean(firstLines(stderr)) || "Git could not fast-forward.");
      }
      await rm(layout.operationFile, { force: true });
      await writeBackKept(layout);

      // A kept choice is for the conflict it answered, not for the next one.
      kept.clear();
      state.conflicts = [];
      state.behind = 0;
      state.head = to;
      logger.info("Brought the clone up to date", { from, to, files: upstream.length });
      // Still under the tree lock: no save runs between the new files and the new model.
      if (modelChanged) await options.onModelChange?.();
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
      const { label, target } = options.groupOf(paths[0]!);
      return {
        key,
        label,
        ...(target ? { target } : {}),
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

  /**
   * The caller holds the remote lock. Throws an `ApiError` when the publication
   * turned back into drafts.
   */
  const push = async (): Promise<PublishResult> => {
    try {
      return await pushHeld();
    } catch (error) {
      if (error instanceof ApiError || error instanceof CloneRefusal) throw error;
      // After an undo, a failure leaves the publication as drafts again.
      const problem = error instanceof RemoteFailure ? error : new RemoteFailure("unknown", clean(String(error)));
      recordError(problem);
      throw new ApiError(
        "conflict",
        `The publication could not be sent and is a draft again. ${problem.message}`,
      );
    }
  };

  const pushHeld = async (): Promise<PublishResult> => {
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
          "The website refused this publication. Its changes are saved again. Tell the person who runs Mica.",
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
            ? "The way the website stores its files changed. Ask the person who runs Mica to restart it, then publish again."
            : "The website changed some of these entries while you published. Resolve the conflicts, then publish again.",
        );
      }
      await options.revalidate?.(paths);
      await locks.tree.write(async () => {
        // A save that landed since would otherwise be published unseen.
        const changed = await changedSince(revision, paths);
        if (changed.length > 0) {
          throw new ApiError(
            "conflict",
            "Some of these changes were edited while they were being published. Review them again, then publish.",
          );
        }
        await recommitPaths(options.tree, paths, revision);
      });
    }
  };

  /** Content paths whose file differs from how `commit` has it. */
  const changedSince = async (commit: string, paths: string[]): Promise<string[]> => {
    const changed: string[] = [];
    for (const path of paths) {
      const inRepository = root === "" ? path : `${root}/${path}`;
      const committed = await git.tryRun(["rev-parse", "--verify", "--quiet", `${commit}:${inRepository}`]);
      const current = existsSync(join(layout.repositoryDir, inRepository))
        ? await git.run(["hash-object", "--", inRepository])
        : null;
      if (committed !== current) changed.push(path);
    }
    return changed;
  };

  const pushOnce = async (args: string[]): Promise<PushOutcome> => {
    try {
      await git.run(args);
      return { kind: "pushed" };
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      return readPush(error.exitCode, error.stdout, error.stderr);
    }
  };

  /** Turns the one unpushed commit back into staged drafts. Nothing is pending after it. */
  const undoPublication = async () => {
    if (!(await pendingPublication())) throw diverged();
    await locks.tree.write(() => git.run(["reset", "--soft", "HEAD^"]));
    state.pendingPush = null;
  };

  const recordError = (problem: RemoteFailure) => {
    if (state.error?.code !== problem.code) {
      logger.warn("Sync failed", { code: problem.code, message: problem.message });
      state.error = { code: problem.code, message: problem.message, since: new Date().toISOString() };
    }
  };

  /** For a caller that holds the remote lock. */
  const syncHeld = async (syncOptions: { skipHold?: boolean } = {}): Promise<SyncState> => {
    if (state.readOnly) return snapshot();
    try {
      await fetch();
      // A reachability failure ends here; other failures last until a whole sync succeeds.
      if (state.error && REACHABILITY.has(state.error.code)) {
        logger.info("The repository is reachable again");
        state.error = null;
      }
      if ((await ahead()) > 0) {
        if (!(await pendingPublication())) throw diverged();
        await push().catch((error: unknown) => {
          // A refusal, a conflict or a recorded failure is in the state now.
          if (!(error instanceof ApiError)) throw error;
        });
      }
      await fastForward(syncOptions.skipHold ?? false);
      if (state.error) logger.info("Sync works again", { after: state.error.code });
      state.error = null;
      state.lastSyncAt = new Date().toISOString();
    } catch (error) {
      // A refusal stops the start; anything else is recorded, and the next sync tries again.
      if (error instanceof CloneRefusal) throw error;
      recordError(error instanceof RemoteFailure ? error : new RemoteFailure("unknown", clean(String(error))));
    }
    return snapshot();
  };

  const sync = (syncOptions: { skipHold?: boolean } = {}): Promise<SyncState> =>
    locks.remote.run(() => syncHeld(syncOptions));

  const snapshot = (): SyncState => ({ ...state, conflicts: [...state.conflicts] });

  const syncStatus = (): SyncStatus => ({
    lastSyncAt: state.lastSyncAt,
    behind: state.behind,
    error: state.error,
    restartRequired: state.restartRequired,
    pendingPush: state.pendingPush,
    refused: state.refused,
    conflicts: state.conflicts.map(({ key, label, paths, upstream, target }) => ({
      group: key,
      label,
      paths,
      upstream,
      ...(target ? { target } : {}),
    })),
  });

  const resolve = async (group: string, choice: "mine" | "website"): Promise<SyncState> => {
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
  };

  const policy: OwnerPolicy = {
    owner: "managed",

    publishAvailability(): PublishAvailability {
      if (state.readOnly) return { enabled: false, reason: state.readOnly };
      if (state.restartRequired) {
        return {
          enabled: false,
          reason: "The way the website stores its files changed. Ask the person who runs Mica to restart it.",
        };
      }
      if (state.conflicts.length > 0) {
        return { enabled: false, reason: "Some entries were changed on the website while you edited them." };
      }
      return { enabled: true };
    },

    // The staging service holds the remote lock from here to the push, so no
    // sync runs between commit and push.
    async prepare() {
      await syncHeld();
      if (state.error?.code === "diverged") throw new ApiError("conflict", state.error.message);
      const availability = policy.publishAvailability();
      if (!availability.enabled) throw new ApiError("conflict", availability.reason);
      if (state.pendingPush) {
        throw new ApiError(
          "conflict",
          "An earlier publication has not reached the website yet. Mica tries again every minute.",
        );
      }
    },

    commitAuthor: (editor: Author | undefined) => editor ?? MICA_IDENTITY,

    // The staging service holds the remote lock around this call.
    async push(_tree, revision) {
      if ((await git.run(["rev-parse", "HEAD"])) !== revision || !(await pendingPublication())) {
        throw new ApiError("conflict", "Mica's copy of the website changed during this publication. Nothing was published. Try again.");
      }
      return push();
    },

    syncStatus,
    sync: async () => void (await sync()),
    resolve: async (group, choice) => void (await resolve(group, choice)),
    upstreamRef,
    describe: async () => ({ url: options.url, branch, cloneBytes: await sizeOf(layout.repositoryDir) }),
  };

  return {
    policy,
    state: snapshot,
    sync,

    resolve,

    // Push the remote's own head, so the answer is about rights, not about
    // whether the clone is behind.
    checkWrite: () =>
      locks.remote.run(() =>
        pushOnce(["push", "--dry-run", "--porcelain", "origin", `refs/remotes/${upstreamRef}:refs/heads/${branch}`]),
      ),

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

/** Bytes of the files under `dir`. */
async function sizeOf(dir: string): Promise<number | null> {
  try {
    let total = 0;
    for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) total += (await stat(join(entry.parentPath, entry.name))).size;
    }
    return total;
  } catch {
    return null;
  }
}

function firstLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, 3)
    .join(" ");
}

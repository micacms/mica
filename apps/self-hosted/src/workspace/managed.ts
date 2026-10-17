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

import type { PublishResult } from "@micacms/core/internal";
import {
  ApiError,
  type Author,
  GitError,
  lfsUnderRoot,
  pushLfsObjects,
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

import { LONGEST_GIT_CALL_MS, NETWORK_CALL_MS, writeBackKept, writeMarker, type CloneLayout } from "./clone.js";
import { redact } from "./credentials.js";
import { classifyFailure, describeFailure, readPush, type FailureClass, type PushOutcome } from "./failures.js";
import { MICA_IDENTITY } from "./isolation.js";
import { fetchLfsObjects } from "./lfs.js";
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
  code: FailureClass | "prefetch_incomplete" | "fast_forward_failed" | "diverged" | "model_unreadable";
  message: string;
  since: string;
}

export interface SyncState {
  head: string | null;
  /** When a sync last reached the remote. */
  lastSyncAt: string | null;
  /** Upstream commits not yet in the clone. */
  behind: number;
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
  /** The secret values to remove from messages, as they are now: a token file can change. */
  secrets?: () => string[];
  syncSeconds: number;
  /** After a fast-forward brought a new content model: the app uses it at once. */
  onModelChange?(): Promise<void>;
  /** Why this image cannot read a content model (the text of `.mica/schema.json`), or null. */
  modelProblem?(manifest: string): Promise<string | null>;
}

export interface ManagedWorkspace {
  policy: OwnerPolicy;
  state(): SyncState;
  /**
   * `skipHold` lets the fast-forward apply a model that this image cannot read:
   * at a start without a readable model, a newer one is the only way forward.
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

/** Failures that keep the clone from the website's version: Publish waits for them. */
const HOLDS = new Set<SyncProblem["code"]>(["diverged", "model_unreadable"]);

/** Failures that a successful fetch ends. */
const REACHABILITY = new Set<SyncProblem["code"]>(["auth", "network", "repo_not_found", "branch_not_found", "unknown"]);

export function createManagedWorkspace(options: ManagedWorkspaceOptions): ManagedWorkspace {
  const { git, layout, locks, logger, branch, root } = options;
  const upstreamRef = `origin/${branch}`;
  const clean = (text: string) => redact(text, options.secrets?.() ?? []);

  const state: SyncState = {
    head: null,
    lastSyncAt: null,
    behind: 0,
    conflicts: [],
    pendingPush: null,
    refused: null,
    error: null,
    readOnly: null,
  };
  /** Groups whose editor chose "Keep my version"; applied at the next fast-forward. */
  const kept = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  /** Drafts that a move to a rewritten branch kept: conflicts until an editor chooses. Lost at a restart. */
  const moved = new Map<string, ConflictGroup>();
  /** A timed sync that finds one running skips its turn, so a slow network does not queue them. */
  let syncing = false;

  const underRoot = (path: string) => root === "" || path.startsWith(`${root}/`);
  const contentPath = (path: string) => (root === "" ? path : path.slice(root.length + 1));
  const groupKey = (path: string) => options.groupOf(contentPath(path)).key;
  const manifestPath = root === "" ? ".mica/schema.json" : `${root}/.mica/schema.json`;

  const fetch = async () => {
    try {
      await git.run(["fetch", "--quiet", "--no-tags", "origin"], { timeoutMs: NETWORK_CALL_MS });
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
   * Whether HEAD is a publication of Mica's that never reached the host. One in
   * the tracking branch's reflog was pushed once and then taken back by a force push.
   */
  const neverPushed = async (): Promise<boolean> => {
    if ((await git.run(["log", "-1", "--format=%ce", "HEAD"])) !== MICA_IDENTITY.email) return false;
    const head = await git.run(["rev-parse", "HEAD"]);
    const known = await git.tryRun(["reflog", "show", "--format=%H", `refs/remotes/${upstreamRef}`]);
    return !(known ?? "").split("\n").includes(head);
  };

  /**
   * Whether HEAD is one unpushed publication of Mica's: one commit ahead, on a
   * base the branch still contains. Anything else ahead means the branch was
   * rewritten; pushing it would undo that.
   */
  const pendingPublication = async (): Promise<boolean> =>
    (await ahead()) === 1 &&
    (await git.tryRun(["merge-base", "--is-ancestor", "HEAD^", upstreamRef])) !== null &&
    (await neverPushed());

  const diverged = () =>
    new RemoteFailure(
      "diverged",
      "The branch was rewritten in the repository (a force push or a reset) during a publication. " +
        "The next sync moves the clone to it.",
    );

  /** The caller holds the remote lock. All network access happens before the tree lock is taken. */
  const fastForward = async (skipHold: boolean): Promise<void> => {
    const from = await git.run(["rev-parse", "HEAD"]);
    const to = await git.run(["rev-parse", upstreamRef]);
    state.head = from;

    if (from === to) {
      state.behind = 0;
      state.conflicts = [...moved.values()];
      return;
    }
    if ((await git.tryRun(["merge-base", "--is-ancestor", "HEAD", upstreamRef])) === null) {
      // The push loop makes Mica's unpushed publication again on top.
      if (await pendingPublication()) return;
      return moveTo(from, to, skipHold);
    }

    const upstream = await prepareVersion(from, to, skipHold);
    state.behind = Number(await git.run(["rev-list", "--count", `${from}..${to}`]));
    const modelChanged = upstream.includes(manifestPath);

    await locks.tree.write(async () => {
      const drafts = await draftPaths(git, root);
      const upstreamInRoot = upstream.filter(underRoot);
      const draftGroups = new Set(drafts.map(groupKey));
      const upstreamGroups = new Set(upstreamInRoot.map(groupKey));

      const conflicting = [...upstreamGroups].filter((key) => draftGroups.has(key) && !kept.has(key) && !moved.has(key));
      if (conflicting.length > 0) {
        state.conflicts = [...(await describeConflicts(conflicting, drafts, upstreamInRoot, from, to)), ...moved.values()];
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
      state.conflicts = [...moved.values()];
      state.behind = 0;
      state.head = to;
      logger.info("Brought the clone up to date", { from, to, files: upstream.length });
      // Still under the tree lock: no save runs between the new files and the new model.
      if (modelChanged) await options.onModelChange?.();
    });
  };

  /**
   * Downloads every file that a move from `from` to `to` writes, and checks that
   * Mica can work with `to`. Returns the paths that change. The move itself
   * must not need the network.
   */
  const prepareVersion = async (from: string, to: string, skipHold: boolean): Promise<string[]> => {
    await git.run(["diff", "--numstat", from, to], { timeoutMs: NETWORK_CALL_MS });
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

    // The LFS files of the new version come from the clone's own LFS store.
    if (await lfsUnderRoot(git, to, root)) {
      try {
        await fetchLfsObjects(git, to, LONGEST_GIT_CALL_MS);
      } catch (error) {
        const stderr = error instanceof GitError ? error.stderr : String(error);
        throw new RemoteFailure("prefetch_incomplete", `Git LFS could not download the files. ${clean(firstLines(stderr))}`.trim());
      }
    }

    const upstream = await changedBetween(git, from, to);

    // Hold a version that Mica cannot work with; the next sync tries again.
    if (upstream.includes(manifestPath) && !skipHold) {
      const manifest = await git.tryRun(["show", `${to}:${manifestPath}`]);
      const problem = manifest === null ? `The new version has no ${manifestPath}.` : await options.modelProblem?.(manifest);
      if (problem) throw new RemoteFailure("model_unreadable", `This Mica cannot read the new content model: ${problem}`);
    }

    return upstream;
  };

  /**
   * Moves the clone to a branch that was rewritten (a force push or a reset).
   * The drafts, and a publication that never reached the host, stay as drafts
   * on the new version, and each of their entries shows as a conflict. The
   * caller holds the remote lock.
   */
  const moveTo = async (from: string, to: string, skipHold: boolean): Promise<void> => {
    const upstream = await prepareVersion(from, to, skipHold);
    await locks.tree.write(async () => {
      // Mica's own commit that the host never had is unpublished work.
      const unpushed = (await neverPushed()) ? (await changedBetween(git, "HEAD^", "HEAD")).filter(underRoot) : [];
      const paths = [...new Set([...(await draftPaths(git, root)), ...unpushed])];
      // The marker of `rescue` lets a start write the drafts back after a crash.
      if (paths.length > 0) await rescue(paths);
      await git.run(["reset", "--hard", "--quiet", to], { env: { GIT_NO_LAZY_FETCH: "1" } });
      await writeBackKept(layout);

      for (const key of new Set(paths.map(groupKey))) {
        const groupPaths = paths.filter((path) => groupKey(path) === key).map(contentPath);
        const { label, target } = options.groupOf(groupPaths[0]!);
        moved.set(key, { key, label, ...(target ? { target } : {}), paths: groupPaths, upstream: "changed" });
      }
      kept.clear();
      state.conflicts = [...moved.values()];
      state.behind = 0;
      state.head = to;
      logger.warn("The branch was rewritten; moved the clone to it and kept the drafts", { from, to, drafts: paths.length });
      if (upstream.includes(manifestPath)) await options.onModelChange?.();
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
      if (error instanceof ApiError) throw error;
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
      const lfsFailure = await pushLfs();
      const outcome: PushOutcome = lfsFailure
        ? { kind: "failed", failure: lfsFailure.failure }
        : await pushOnce(["push", "--porcelain", "origin", `HEAD:refs/heads/${branch}`]);
      const failed = (failure: FailureClass) => {
        if (!lfsFailure) return describeFailure(failure);
        return `Git LFS could not send the files. ${failure === "unknown" ? lfsFailure.detail : describeFailure(failure)}`;
      };

      if (outcome.kind === "pushed") {
        state.pendingPush = null;
        state.refused = null;
        logger.info("Pushed a publication", { revision });
        return { state: "published", revision };
      }

      if (outcome.kind === "remote-rejected" || (outcome.kind === "failed" && outcome.failure === "write_forbidden")) {
        const reason = outcome.kind === "remote-rejected" ? clean(outcome.reason) : failed("write_forbidden");
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
        const reason = outcome.kind === "failed" ? failed(outcome.failure) : "The remote kept moving.";
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
      if (state.conflicts.length > 0) {
        throw new ApiError(
          "conflict",
          "The website changed some of these entries while you published. Resolve the conflicts, then publish again.",
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

  /**
   * Sends the LFS objects of the publication before the commit, as the LFS
   * pre-push hook would; hooks are off. A failure, or null.
   */
  const pushLfs = async (): Promise<{ failure: FailureClass; detail: string } | null> => {
    if (!(await lfsUnderRoot(git, "HEAD", root))) return null;
    try {
      await pushLfsObjects(git, "origin", "HEAD", NETWORK_CALL_MS);
      return null;
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      const detail = clean(firstLines(error.stderr));
      logger.warn("Git LFS could not send the files of a publication", { error: detail });
      // Git LFS says "Authorization error" for a 401 and a 403. The fetch before
      // the publication proved the token, so here it means no write access.
      const failure = /Authorization error/.test(error.stderr) ? "write_forbidden" : classifyFailure(error.stderr);
      return { failure, detail };
    }
  };

  const pushOnce = async (args: string[]): Promise<PushOutcome> => {
    try {
      await git.run(args, { timeoutMs: NETWORK_CALL_MS });
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
      // Anything else ahead is a rewritten branch, which `fastForward` moves to.
      if ((await ahead()) > 0 && (await pendingPublication())) {
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
      // Recorded; the next sync tries again.
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
    // A moved group's drafts are on the website's version already: "mine" keeps them as they are.
    const wasMoved = moved.delete(group);
    if (choice === "mine") {
      if (!wasMoved) kept.add(group);
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
      if (state.conflicts.length > 0) {
        return { enabled: false, reason: "Some entries were changed on the website while you edited them." };
      }
      return { enabled: true };
    },

    // The staging service holds the remote lock from here to the push, so no
    // sync runs between commit and push.
    async prepare() {
      await syncHeld();
      // The website has a version that Mica cannot bring in, so a publication cannot go on top of it.
      if (state.error && HOLDS.has(state.error.code)) throw new ApiError("conflict", state.error.message);
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

    /** Syncs at once, and then every `syncSeconds`. */
    start() {
      if (timer) return;
      const tick = () => {
        if (syncing) return;
        syncing = true;
        sync()
          .catch((error: unknown) => logger.error("Sync crashed", { error: String(error) }))
          .finally(() => (syncing = false));
      };
      tick();
      timer = setInterval(tick, options.syncSeconds * 1000);
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** Bytes of the files under `dir`. */
export async function sizeOf(dir: string): Promise<number | null> {
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

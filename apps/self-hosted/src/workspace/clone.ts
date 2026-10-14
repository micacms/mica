/**
 * Mica's clone on the data volume. The clone holds the drafts and at most one
 * unpushed commit, so a clone that does not match the configuration is replaced
 * only when it holds neither. At start, it finishes what a crash interrupted.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";

import { ConfigError, gitRunner, type GitRunner, type Logger } from "@micacms/runtime";

import { contentRootAt } from "./content-root.js";
import { writeIsolationAttributes } from "./isolation.js";
import { lfsUnderRoot } from "./lfs.js";
import { changedBetween, draftPaths, restorePaths } from "./restore.js";

/** The longest a local Git call may run. */
export const LONGEST_GIT_CALL_MS = 10 * 60_000;
/** The longest a fetch or a push may run; the low-speed limit stops a stalled one sooner (`isolation.ts`). */
export const NETWORK_CALL_MS = 5 * 60_000;
/** The longest the first clone may run: a repository with many images is large. */
const CLONE_MS = 60 * 60_000;

export interface CloneLayout {
  dataDir: string;
  /** The layout version of the volume (`VOLUME_VERSION`). */
  volumeFile: string;
  repositoryDir: string;
  /** Marks a fast-forward in progress. */
  operationFile: string;
  /** Marks a "Keep my version" in progress; its copies are in `rescueDir`. */
  keepMineFile: string;
  rescueDir: string;
}

export function cloneLayout(dataDir: string): CloneLayout {
  return {
    dataDir,
    volumeFile: join(dataDir, "volume.json"),
    repositoryDir: join(dataDir, "repository"),
    operationFile: join(dataDir, "operation.json"),
    keepMineFile: join(dataDir, "keep-mine.json"),
    rescueDir: join(dataDir, "rescue"),
  };
}

/** The layout of the data volume. A Mica that changes the layout writes a higher number. */
export const VOLUME_VERSION = 1;

/** A start that must not go on. The message tells the operator what to do. */
export class CloneRefusal extends ConfigError {
  override name = "CloneRefusal";
}

export interface OpenCloneOptions {
  layout: CloneLayout;
  url: string;
  branch: string;
  /** `MICA_CONTENT_PATH`, or null to find the root in the clone. */
  root: string | null;
  env: NodeJS.ProcessEnv;
  logger: Logger;
}

export interface OpenedClone {
  git: GitRunner;
  /** The content root, repository-relative. */
  root: string;
}

/** Makes or finds the clone, recovers it, and returns a runner for it and the content root. */
export async function openClone(options: OpenCloneOptions): Promise<OpenedClone> {
  const { layout, logger } = options;
  const git = runner(layout.repositoryDir, options.env);
  await claimVolume(layout);
  await removeUnfinishedClones(layout);

  if (!existsSync(join(layout.repositoryDir, ".git"))) {
    if (existsSync(layout.repositoryDir) && (await readdir(layout.repositoryDir)).length > 0) {
      throw new CloneRefusal(
        `${layout.repositoryDir} exists but is not a Git clone. Move it away, or delete it, and start again.`,
      );
    }
    await refuseRescuedDrafts(layout);
    return { git, root: await cloneFresh(options) };
  }

  if ((await git.tryRun(["rev-parse", "--git-dir"])) === null) {
    throw new CloneRefusal(
      `${layout.repositoryDir} is not a valid Git repository. If it holds no unpublished work, delete it and start again.`,
    );
  }

  const url = await git.tryRun(["config", "--get", "remote.origin.url"]);
  const branch = await git.tryRun(["rev-parse", "--abbrev-ref", "HEAD"]);

  // A renamed repository, or one that moved: the next sync fetches from the new URL. If its
  // branch has another history, the sync moves the clone to it and keeps the drafts.
  if (url !== options.url && branch === options.branch) {
    await git.run(["remote", "set-url", "origin", options.url]);
    logger.info("The repository URL changed; the clone fetches from the new one", { was: url, url: options.url });
  } else if (branch !== options.branch) {
    const drafts = await draftPaths(git, "");
    const ahead = Number((await git.tryRun(["rev-list", "--count", `origin/${branch}..HEAD`])) ?? "0");
    await refuseRescuedDrafts(layout);
    if (drafts.length > 0 || ahead > 0) {
      const listed = drafts.slice(0, 10).map((path) => `    ${path}`).join("\n");
      throw new CloneRefusal(
        `The clone on the data volume is for ${url ?? "an unknown remote"} (${branch ?? "no branch"}),\n` +
          `  but MICA_REPOSITORY_BRANCH says ${options.branch}.\n` +
          `  It holds work that is not published${ahead > 0 ? " (one commit not pushed)" : ""}:\n` +
          `${listed}${drafts.length > 10 ? "\n    …" : ""}\n` +
          "  Start Mica with the old configuration and publish, or copy the drafts out with\n" +
          `    docker compose cp mica:${layout.repositoryDir} ./mica-drafts\n` +
          "  and delete the volume.",
      );
    }
    logger.info("The clone is for another branch and holds no work; cloning again", {
      was: url,
      branch,
    });
    await rm(layout.repositoryDir, { recursive: true, force: true });
    return { git, root: await cloneFresh(options) };
  }

  await writeIsolationAttributes(join(layout.repositoryDir, ".git"));
  await removeLocks(layout, logger);
  const root = await contentRootAt(git, "HEAD", options.root);
  await recover(git, options, root);
  return { git, root };
}

/**
 * Clones into a temporary directory, so a clone stopped half-way never looks
 * like one whose files were deleted. Returns the content root.
 */
async function cloneFresh(options: OpenCloneOptions): Promise<string> {
  const { layout } = options;
  await mkdir(layout.dataDir, { recursive: true });
  // Recovery markers belong to the clone they were written for, never to this one.
  await rm(layout.operationFile, { force: true });
  await rm(layout.rescueDir, { recursive: true, force: true });

  const outside = runner(layout.dataDir, options.env);
  const temporary = `${layout.repositoryDir}${UNFINISHED}${process.pid}`;
  await rm(temporary, { recursive: true, force: true });

  options.logger.info("Cloning the content repository", { url: options.url, branch: options.branch });
  // No checkout yet, so the isolation attributes are in place before the first file is written.
  await outside.run([
    "clone",
    "--filter=blob:none",
    "--single-branch",
    "--no-checkout",
    "--branch",
    options.branch,
    "--",
    options.url,
    temporary,
  ], { timeoutMs: CLONE_MS });

  let root: string;
  try {
    const git = runner(temporary, options.env);
    await writeIsolationAttributes(join(temporary, ".git"));

    root = await contentRootAt(git, "HEAD", options.root);
    const lfs = await lfsUnderRoot(git, "HEAD", root);
    if (lfs) throw lfsRefusal(lfs, root);

    // `checkout` fetches the missing blobs in one batch; `restore` would fetch
    // them one request at a time.
    await git.run(["checkout", "--force", "--quiet", "HEAD"], { timeoutMs: CLONE_MS });
    await rename(temporary, layout.repositoryDir);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const head = await runner(layout.repositoryDir, options.env).run(["rev-parse", "HEAD"]);
  options.logger.info("Cloned the content repository", { head, root });
  return root;
}

/** Refuses a volume with another layout version, and marks a new one with this version. */
async function claimVolume(layout: CloneLayout): Promise<void> {
  const version = await volumeVersion(layout);
  if (version !== null && version !== VOLUME_VERSION) {
    throw new CloneRefusal(
      `${layout.volumeFile} says that the data volume has layout version ${version}, and this Mica knows version ` +
        `${VOLUME_VERSION}.\n  Start the Mica version that made the volume, or use a new volume.`,
    );
  }
  if (version === null) {
    await mkdir(layout.dataDir, { recursive: true });
    await writeMarker(layout.volumeFile, { version: VOLUME_VERSION });
  }
}

/** The volume's layout version, or null for a volume without the file. */
export async function volumeVersion(layout: CloneLayout): Promise<number | null> {
  const marker = await readMarker<{ version?: number }>(layout.volumeFile);
  return marker?.version ?? null;
}

const UNFINISHED = ".unfinished-";

async function removeUnfinishedClones(layout: CloneLayout): Promise<void> {
  if (!existsSync(layout.dataDir)) return;
  const prefix = `${basename(layout.repositoryDir)}${UNFINISHED}`;
  for (const name of await readdir(layout.dataDir)) {
    if (name.startsWith(prefix)) await rm(join(layout.dataDir, name), { recursive: true, force: true });
  }
}

/**
 * An interrupted "Keep my version" holds drafts in the rescue directory; they
 * must not go with the clone.
 */
async function refuseRescuedDrafts(layout: CloneLayout): Promise<void> {
  if (!existsSync(layout.keepMineFile)) return;
  throw new CloneRefusal(
    `${layout.keepMineFile} says that ${layout.rescueDir} holds drafts from an interrupted "Keep my version".\n` +
      "  Start Mica with the configuration of that clone to restore them, or copy them out of the rescue\n" +
      "  directory and delete keep-mine.json.",
  );
}

export function lfsRefusal(file: string, root: string): CloneRefusal {
  return new CloneRefusal(
    `${file} assigns Git LFS to files under the content root (${root}).\n` +
      "  Mica does not support Git LFS yet: it would commit whole files where LFS\n" +
      "  should hold pointers. Keep LFS out of the content root.",
  );
}

/**
 * Removes every lock file in `.git` that a stop or a crash left. The caller
 * holds the volume's lease (`lease.ts`), so no other process owns one.
 */
async function removeLocks(layout: CloneLayout, logger: Logger): Promise<void> {
  const gitDir = join(layout.repositoryDir, ".git");
  for (const entry of await readdir(gitDir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
    const lock = join(entry.parentPath, entry.name);
    await rm(lock, { force: true });
    logger.warn("Removed a lock file that a stop or a crash left", { lock });
  }
}

interface OperationMarker {
  from: string;
  to: string;
}

interface KeepMineMarker {
  /** Repository-relative path → its file in the rescue directory, or null for a deletion. */
  files: Record<string, string | null>;
}

/** Writes a marker so that it is either there whole or not at all. */
export async function writeMarker(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, file);
}

async function recover(git: GitRunner, options: OpenCloneOptions, root: string): Promise<void> {
  const { layout, logger } = options;

  const operation = await readMarker<OperationMarker>(layout.operationFile);
  if (operation) {
    // Safe without a copy of the drafts: the fast-forward ran after the
    // conflict check, so no upstream path is a draft.
    const paths = await changedBetween(git, operation.from, operation.to);
    await restorePaths(git, layout.repositoryDir, operation.to, paths);
    await git.run(["update-ref", `refs/heads/${options.branch}`, operation.to]);
    await rm(layout.operationFile, { force: true });
    logger.warn("Finished a fast-forward that a crash interrupted", { to: operation.to, paths: paths.length });
  }

  if (await readMarker<KeepMineMarker>(layout.keepMineFile)) {
    await writeBackKept(layout);
    logger.warn("Restored the drafts of an interrupted \"Keep my version\"");
  }

  // Temporary files and folders of a save that a crash interrupted.
  for (const path of await draftPaths(git, root)) {
    const temporary = /^(.*?\.mica-\d+-\d+)(?:\/|$)/.exec(path);
    if (temporary) await rm(join(layout.repositoryDir, temporary[1]!), { recursive: true, force: true });
  }
}

/** Writes the rescued drafts back over the tree, then deletes the rescue. */
export async function writeBackKept(layout: CloneLayout): Promise<void> {
  const marker = await readMarker<KeepMineMarker>(layout.keepMineFile);
  if (!marker) return;
  for (const [path, copy] of Object.entries(marker.files)) {
    const target = join(layout.repositoryDir, path);
    if (copy === null) {
      await rm(target, { force: true });
      continue;
    }
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, await readFile(join(layout.rescueDir, copy)));
  }
  await rm(layout.keepMineFile, { force: true });
  await rm(layout.rescueDir, { recursive: true, force: true });
}

async function readMarker<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function runner(cwd: string, env: NodeJS.ProcessEnv): GitRunner {
  return gitRunner(cwd, { env, timeoutMs: LONGEST_GIT_CALL_MS, maxBuffer: 256 * 1024 * 1024 });
}

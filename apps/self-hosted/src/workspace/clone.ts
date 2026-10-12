/**
 * Mica's own clone on the data volume: making it, and finding it again.
 *
 * The clone is a cache that also holds the drafts and, at most, one commit
 * that is not pushed yet. So a clone that does not match the configuration is
 * thrown away only when it holds neither; otherwise Mica refuses to start and
 * says how to get the work out. Mica writes no state file of its own: the
 * clone's URL and branch are read from the clone.
 *
 * At every start this module also finishes what a crash interrupted: a
 * fast-forward (`operation.json`), a "Keep my version" (`keep-mine.json`), a
 * stale `index.lock`, and the temporary files of a save.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

import { ConfigError, gitRunner, type GitRunner, type Logger } from "@micacms/runtime";

import { writeIsolationAttributes } from "./isolation.js";
import { lfsUnderRoot } from "./lfs.js";
import { changedBetween, draftPaths, restorePaths } from "./restore.js";

/** The longest a Git call may run. A lock older than this has no owner left. */
export const LONGEST_GIT_CALL_MS = 10 * 60_000;

export interface CloneLayout {
  dataDir: string;
  /** `<dataDir>/repository` */
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
    repositoryDir: join(dataDir, "repository"),
    operationFile: join(dataDir, "operation.json"),
    keepMineFile: join(dataDir, "keep-mine.json"),
    rescueDir: join(dataDir, "rescue"),
  };
}

/** A start that must not go on. The message tells the operator what to do. */
export class CloneRefusal extends ConfigError {
  override name = "CloneRefusal";
}

export interface OpenCloneOptions {
  layout: CloneLayout;
  /** Configured URL, without credentials. */
  url: string;
  branch: string;
  /** Content root inside the repository. */
  root: string;
  env: NodeJS.ProcessEnv;
  logger: Logger;
}

/** Makes or finds the clone, recovers it, and returns a runner for it. */
export async function openClone(options: OpenCloneOptions): Promise<GitRunner> {
  const { layout, logger } = options;
  const git = runner(layout.repositoryDir, options.env);

  if (!existsSync(join(layout.repositoryDir, ".git"))) {
    if (existsSync(layout.repositoryDir) && (await readdir(layout.repositoryDir)).length > 0) {
      throw new CloneRefusal(
        `${layout.repositoryDir} exists but is not a Git clone. Move it away, or delete it, and start again.`,
      );
    }
    await cloneFresh(options);
    return git;
  }

  if ((await git.tryRun(["rev-parse", "--git-dir"])) === null) {
    throw new CloneRefusal(
      `${layout.repositoryDir} is not a valid Git repository. If it holds no unpublished work, delete it and start again.`,
    );
  }

  const url = await git.tryRun(["config", "--get", "remote.origin.url"]);
  const branch = await git.tryRun(["rev-parse", "--abbrev-ref", "HEAD"]);

  if (url !== options.url || branch !== options.branch) {
    const drafts = await draftPaths(git, "");
    const ahead = Number((await git.tryRun(["rev-list", "--count", `origin/${branch}..HEAD`])) ?? "0");
    if (drafts.length > 0 || ahead > 0) {
      const listed = drafts.slice(0, 10).map((path) => `    ${path}`).join("\n");
      throw new CloneRefusal(
        `The clone on the data volume is for ${url ?? "an unknown remote"} (${branch ?? "no branch"}),\n` +
          `  but MICA_REPOSITORY_URL and MICA_REPOSITORY_BRANCH say ${options.url} (${options.branch}).\n` +
          `  It holds work that is not published${ahead > 0 ? " (one commit not pushed)" : ""}:\n` +
          `${listed}${drafts.length > 10 ? "\n    …" : ""}\n` +
          "  Start Mica with the old configuration and publish, or copy the drafts out with\n" +
          `    docker compose cp mica:${layout.repositoryDir}/${options.root} ./mica-drafts\n` +
          "  and delete the volume.",
      );
    }
    logger.info("The clone is for another repository or branch and holds no work; cloning again", {
      was: url,
      branch,
    });
    await rm(layout.repositoryDir, { recursive: true, force: true });
    await cloneFresh(options);
    return git;
  }

  await writeIsolationAttributes(join(layout.repositoryDir, ".git"));
  await removeStaleLock(layout, logger);
  await recover(git, options);
  return git;
}

async function cloneFresh(options: OpenCloneOptions): Promise<void> {
  const { layout } = options;
  await mkdir(layout.dataDir, { recursive: true });
  const outside = runner(layout.dataDir, options.env);

  options.logger.info("Cloning the content repository", { url: options.url, branch: options.branch });
  // Blobless and single branch: no history blobs. No checkout yet, so the
  // isolation attributes are in place before the first file is written.
  await outside.run([
    "clone",
    "--filter=blob:none",
    "--single-branch",
    "--no-checkout",
    "--branch",
    options.branch,
    "--",
    options.url,
    layout.repositoryDir,
  ]);

  const git = runner(layout.repositoryDir, options.env);
  await writeIsolationAttributes(join(layout.repositoryDir, ".git"));

  const lfs = await lfsUnderRoot(git, "HEAD", options.root);
  if (lfs) throw lfsRefusal(lfs, options.root);

  // A fresh clone has nothing to lose: fill the index and the tree from HEAD.
  // `checkout` fetches the missing blobs in one batch; `restore` would fetch
  // them one request at a time.
  await git.run(["checkout", "--force", "--quiet", "HEAD"]);
  options.logger.info("Cloned the content repository", { head: await git.run(["rev-parse", "HEAD"]) });
}

/** Refuses LFS under the content root; Mica does not support it yet. */
export function lfsRefusal(file: string, root: string): CloneRefusal {
  return new CloneRefusal(
    `${file} assigns Git LFS to files under the content root (${root || "the repository root"}).\n` +
      "  Mica does not support Git LFS yet: it would commit whole files where LFS\n" +
      "  should hold pointers. Keep LFS out of the content root.",
  );
}

async function removeStaleLock(layout: CloneLayout, logger: Logger): Promise<void> {
  const lock = join(layout.repositoryDir, ".git", "index.lock");
  const found = await stat(lock).catch(() => null);
  if (!found) return;
  // A younger lock can belong to a process that still runs — a rolling
  // deploy, or `check` — so only an old one is removed.
  if (Date.now() - found.mtimeMs < LONGEST_GIT_CALL_MS) return;
  await rm(lock, { force: true });
  logger.warn("Removed a stale index.lock", { lock });
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

async function recover(git: GitRunner, options: OpenCloneOptions): Promise<void> {
  const { layout, logger } = options;

  const operation = await readMarker<OperationMarker>(layout.operationFile);
  if (operation) {
    // Safe without a copy of the drafts: the fast-forward ran only after the
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

  // A save's temporary files, left behind by a crash during the save.
  for (const path of await draftPaths(git, options.root)) {
    if (/\.mica-\d+-\d+$/.test(path)) await rm(join(layout.repositoryDir, path), { force: true });
  }
}

/** Writes the rescued drafts back over the tree, then forgets them. */
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

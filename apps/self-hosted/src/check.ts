/**
 * `check`: whether this configuration can serve its repository. It works in a
 * temporary repository and only reads the data volume, so it is safe while the
 * server runs. A dry-run push cannot see branch protection or server hooks.
 */

import { accessSync, constants, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { discover, redirectUri } from "@micacms/auth-oidc";
import { memorySource } from "@micacms/core/internal";
import { ConfigError, GitError, gitRunner, loadSchema, SchemaError, type GitRunner } from "@micacms/runtime";

import { currentToken, loadConfig, type RepositoryConfig, type SelfHostedConfig } from "./config.js";
import { CloneRefusal, cloneLayout, VOLUME_VERSION, volumeVersion } from "./workspace/clone.js";
import { contentRootAt } from "./workspace/content-root.js";
import { redact } from "./workspace/credentials.js";
import { classifyFailure, describeFailure, readPush } from "./workspace/failures.js";
import { managedEnvironment } from "./workspace/isolation.js";
import { lfsUnderRoot } from "./workspace/lfs.js";
import { draftPaths } from "./workspace/restore.js";

/** Runs the checks, prints one line per check, and returns the exit code. */
export async function runCheck(
  env: NodeJS.ProcessEnv = process.env,
  out: { write(text: string): unknown } = process.stdout,
): Promise<number> {
  const say = (line: string) => out.write(`${line}\n`);

  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      say(`FAIL  configuration\n${error.message}`);
      return 78;
    }
    throw error;
  }

  const { remote, branch, token, tokenFile, username } = config.repository;
  const clean = (text: string) => redact(text, [currentToken(config.repository)]);
  let failures = 0;
  const pass = (what: string, detail = "") => say(`ok    ${what}${detail ? `: ${detail}` : ""}`);
  const fail = (what: string, detail: string) => {
    failures += 1;
    say(`FAIL  ${what}: ${detail}`);
  };

  await checkIdentityProvider(config, pass, fail);
  say(`Repository ${remote.url} (branch ${branch})`);

  let root: string | null = null;
  const scratch = mkdtempSync(join(tmpdir(), "mica-check-"));
  try {
    const git = gitRunner(scratch, {
      env: managedEnvironment({ remote, cloneDir: scratch, username, token, tokenFile }),
      timeoutMs: 120_000,
    });
    await git.run(["init", "--quiet"]);
    await git.run(["remote", "add", "origin", remote.url]);

    try {
      await git.run(["fetch", "--quiet", "--no-tags", "--depth=1", "--filter=blob:none", "origin", `refs/heads/${branch}`]);
      pass("read access", (await git.run(["rev-parse", "--short", "FETCH_HEAD"])) + ` is the head of ${branch}`);
    } catch (error) {
      fail("read access", failureText(error, clean));
      return 1;
    }

    await checkWrite(git, branch, clean, pass, fail);
    try {
      root = await contentRootAt(git, "FETCH_HEAD", config.repository.root);
      pass("content root", root);
      await checkContent(git, root, pass, fail);
    } catch (error) {
      if (!(error instanceof CloneRefusal)) throw error;
      fail("content root", error.message);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  await checkVolume(config.dataDir, { ...config.repository, root }, pass, fail);

  say(failures === 0 ? "All checks passed." : `${failures} check${failures === 1 ? "" : "s"} failed.`);
  return failures === 0 ? 0 : 1;
}

async function checkWrite(
  git: GitRunner,
  branch: string,
  clean: (text: string) => string,
  pass: (what: string, detail?: string) => void,
  fail: (what: string, detail: string) => void,
): Promise<void> {
  const args = ["push", "--dry-run", "--porcelain", "origin", `FETCH_HEAD:refs/heads/${branch}`];
  try {
    await git.run(args);
    pass("push rights", "the token may push (branch protection is checked only by a real push)");
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    const outcome = readPush(error.exitCode, error.stdout, error.stderr);
    fail(
      "push rights",
      outcome.kind === "failed" ? `${describeFailure(outcome.failure)} ${clean(firstLine(error.stderr))}` : clean(error.stderr),
    );
  }
}

async function checkContent(
  git: GitRunner,
  root: string,
  pass: (what: string, detail?: string) => void,
  fail: (what: string, detail: string) => void,
): Promise<void> {
  const manifest = await git.tryRun(["show", `FETCH_HEAD:${root}/.mica/schema.json`]);
  if (manifest === null) {
    fail(
      "content model",
      `no ${root}/.mica/schema.json on the branch. Build the site once, commit the content root with ` +
        ".mica/schema.json, and push it.",
    );
  } else {
    try {
      const model = await loadSchema(memorySource({ ".mica/schema.json": manifest }, "check"));
      pass(
        "content model",
        `${Object.keys(model.collections).length} collections, ${Object.keys(model.singletons).length} singletons`,
      );
    } catch (error) {
      if (!(error instanceof SchemaError)) throw error;
      fail("content model", error.message);
    }
  }

  const lfs = await lfsUnderRoot(git, "FETCH_HEAD", root);
  if (lfs) fail("Git LFS", `${lfs} assigns LFS under the content root, which Mica does not support yet.`);
  else pass("Git LFS", "not used under the content root");
}

async function checkIdentityProvider(
  config: SelfHostedConfig,
  pass: (what: string, detail?: string) => void,
  fail: (what: string, detail: string) => void,
): Promise<void> {
  const register = `Register the redirect URI ${redirectUri(config)}`;
  try {
    const { issuer } = (await discover(config)).serverMetadata();
    pass("identity provider", `${issuer} answers. ${register}`);
  } catch (error) {
    fail("identity provider", `${config.MICA_OIDC_ISSUER} cannot be discovered: ${(error as Error).message}. ${register}`);
  }
}

/** Looks at the volume without writing to it: the server may be running on it. */
async function checkVolume(
  dataDir: string,
  repository: RepositoryConfig,
  pass: (what: string, detail?: string) => void,
  fail: (what: string, detail: string) => void,
): Promise<void> {
  const { remote, branch, root, token, tokenFile, username } = repository;
  const layout = cloneLayout(dataDir);

  // The nearest directory that exists is where the start creates the rest.
  let existing = dataDir;
  while (!existsSync(existing)) existing = dirname(existing);
  try {
    accessSync(existing, constants.W_OK);
  } catch {
    return fail("data volume", `${existing} is not writable for this user (uid ${process.getuid?.() ?? "?"}).`);
  }
  const version = await volumeVersion(layout);
  if (version !== null && version !== VOLUME_VERSION) {
    return fail("data volume", `layout version ${version}; this Mica knows version ${VOLUME_VERSION}.`);
  }
  if (!existsSync(join(layout.repositoryDir, ".git"))) {
    return pass("data volume", `writable, no clone yet in ${layout.repositoryDir}; the first start makes it`);
  }

  const git = gitRunner(layout.repositoryDir, {
    env: { ...managedEnvironment({ remote, cloneDir: layout.repositoryDir, username, token, tokenFile }), GIT_OPTIONAL_LOCKS: "0" },
  });
  const head = await git.tryRun(["rev-parse", "--short", "HEAD"]);
  const drafts = await draftPaths(git, root ?? "").catch(() => null);
  if (head === null || drafts === null) return fail("data volume", `the clone in ${layout.repositoryDir} cannot be read.`);
  const ahead = Number((await git.tryRun(["rev-list", "--count", `origin/${branch}..HEAD`])) ?? "0");
  const interrupted = [layout.operationFile, layout.keepMineFile].filter((file) => existsSync(file));
  pass(
    "data volume",
    `a clone at ${head}, with ${drafts.length} unpublished draft files` +
      (ahead > 0 ? ", and a commit that is not pushed" : "") +
      (interrupted.length > 0 ? `; the next start finishes the work that ${interrupted.join(" and ")} records` : ""),
  );
}

function failureText(error: unknown, clean: (text: string) => string): string {
  if (!(error instanceof GitError)) return String(error);
  return `${describeFailure(classifyFailure(error.stderr))} ${clean(firstLine(error.stderr))}`;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

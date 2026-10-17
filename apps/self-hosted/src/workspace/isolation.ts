/**
 * The repository is under someone else's control, and the server holds secrets.
 * So `git` gets an allowlisted environment, never `process.env`, and its
 * settings come from `GIT_CONFIG_*`, which beat any repository or image
 * configuration. This closes every path from repository content to code
 * execution: no hooks, symlinks, or transports other than HTTPS, and no
 * filter but Git LFS. A `filter=` attribute acts only through a driver in the
 * configuration, and the repository cannot set one, so Mica's LFS driver is
 * the only one. LFS reads `.lfsconfig` from the repository; the endpoint and
 * the push rules here override it, so the content cannot send the files or
 * the token to another server.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";

import { lfsEndpoint, type Remote } from "./credentials.js";

export interface ManagedEnvironmentOptions {
  remote: Remote;
  /** Absolute path of the clone. Git refuses a repository with another owner unless it is named. */
  cloneDir: string;
  username: string;
  token?: string | null;
  /** A file with the token, read by the helper for each call. */
  tokenFile?: string | null;
  /** `MICA_REPOSITORY_LFS_URL`, or null for the endpoint that Git LFS derives from the clone URL. */
  lfsUrl?: Remote | null;
}

/** The committer of every publication; the author is the editor. */
export const MICA_IDENTITY = { name: "Mica CMS", email: "mica@localhost" } as const;

/**
 * Answers only Git's `get`, with the username and token from the environment of
 * that `git` process, or the token from the file that it names.
 */
const HELPER =
  '!f() { test "$1" = get || exit 0; echo "username=$MICA_GIT_USERNAME"; ' +
  'if [ -n "$MICA_GIT_TOKEN_FILE" ]; then printf "password=%s\\n" "$(cat "$MICA_GIT_TOKEN_FILE")"; ' +
  'else echo "password=$MICA_GIT_TOKEN"; fi; }; f';

export function managedEnvironment(options: ManagedEnvironmentOptions): NodeJS.ProcessEnv {
  const { remote } = options;
  const lfs = options.lfsUrl ?? null;
  const lfsUrl = lfs?.url ?? lfsEndpoint(remote);
  // The operator named the LFS host, so it gets the token too.
  const hosts = [remote, ...(lfs && lfs.hostKey !== remote.hostKey ? [lfs] : [])];

  const config: Array<[string, string]> = [
    // Clear every other helper, then add ours for the configured hosts only.
    ["credential.helper", ""],
    ...(options.token || options.tokenFile
      ? hosts.map((host): [string, string] => [`credential.${host.scheme}://${host.hostKey}.helper`, HELPER])
      : []),
    ["core.hooksPath", devNull],
    ["core.symlinks", "false"],
    ["core.autocrlf", "false"],
    ["core.fsmonitor", "false"],
    ["protocol.allow", "never"],
    ["protocol.https.allow", "always"],
    ...(remote.scheme === "http" ? ([["protocol.http.allow", "always"]] as Array<[string, string]>) : []),
    ["submodule.recurse", "false"],
    // The one filter driver, as `git lfs install` writes it. `required`: a failed download stops the checkout.
    ["filter.lfs.process", "git-lfs filter-process"],
    ["filter.lfs.clean", "git-lfs clean -- %f"],
    ["filter.lfs.smudge", "git-lfs smudge -- %f"],
    ["filter.lfs.required", "true"],
    // Above `.lfsconfig`, which could send the uploads somewhere else.
    ["lfs.url", lfsUrl],
    ["lfs.pushurl", lfsUrl],
    // A push without all of its LFS objects would publish pointers to nothing.
    ["lfs.allowincompletepush", "false"],
    // Mica does not use LFS locks; this saves a request to the host for each push.
    ["lfs.locksverify", "false"],
    // No automatic gc inside a commit that holds the tree lock; the sync runs
    // `git -c gc.auto=… gc --auto` instead.
    ["gc.auto", "0"],
    // Never in the background: a stop would leave its lock files behind.
    ["gc.autoDetach", "false"],
    // A transfer that stays below 1 kB/s for a minute stops, so a stalled network does not block Publish.
    ["http.lowSpeedLimit", "1000"],
    ["http.lowSpeedTime", "60"],
    // A repack of a repository with many large images stays within a small container's memory.
    ["pack.threads", "1"],
    ["pack.windowMemory", "256m"],
    ["core.bigFileThreshold", "16m"],
    // Faster status and index writes for a tree with many files.
    ["feature.manyFiles", "true"],
    ["core.untrackedCache", "true"],
    ["safe.directory", options.cloneDir],
    ["user.name", MICA_IDENTITY.name],
    ["user.email", MICA_IDENTITY.email],
  ];

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: tmpdir(),
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_LITERAL_PATHSPECS: "1",
    GIT_COMMITTER_NAME: MICA_IDENTITY.name,
    GIT_COMMITTER_EMAIL: MICA_IDENTITY.email,
    GIT_CONFIG_COUNT: String(config.length),
  };
  config.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  if (options.token || options.tokenFile) env.MICA_GIT_USERNAME = options.username;
  if (options.token) env.MICA_GIT_TOKEN = options.token;
  else if (options.tokenFile) env.MICA_GIT_TOKEN_FILE = options.tokenFile;
  return env;
}

/**
 * Overrides `.gitattributes` so the bytes on disk are the bytes in Git, except
 * for the files that `filter=lfs` gives to Git LFS (see the top of this file).
 * Write it before the first checkout.
 */
export async function writeIsolationAttributes(gitDir: string): Promise<void> {
  const info = join(gitDir, "info");
  await mkdir(info, { recursive: true });
  await writeFile(join(info, "attributes"), "* -text -ident -working-tree-encoding\n");
}

/**
 * The repository is under someone else's control, and the server holds secrets.
 * So `git` gets an allowlisted environment, never `process.env`, and its
 * settings come from `GIT_CONFIG_*`, which beat any repository or image
 * configuration. This closes every path from repository content to code
 * execution: no hooks, filters, symlinks, or transports other than HTTPS.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";

import type { Remote } from "./credentials.js";

export interface ManagedEnvironmentOptions {
  remote: Remote;
  /** Absolute path of the clone. Git refuses a repository with another owner unless it is named. */
  cloneDir: string;
  username: string;
  token?: string;
}

/** The committer of every publication; the author is the editor. */
export const MICA_IDENTITY = { name: "Mica CMS", email: "mica@localhost" } as const;

/**
 * Answers only Git's `get`, with the username and token from the environment of
 * that `git` process.
 */
const HELPER =
  '!f() { test "$1" = get || exit 0; echo "username=$MICA_GIT_USERNAME"; echo "password=$MICA_GIT_TOKEN"; }; f';

export function managedEnvironment(options: ManagedEnvironmentOptions): NodeJS.ProcessEnv {
  const { remote } = options;

  const config: Array<[string, string]> = [
    // Clear every other helper, then add ours for the configured host only.
    ["credential.helper", ""],
    ...(options.token
      ? ([[`credential.${remote.scheme}://${remote.hostKey}.helper`, HELPER]] as Array<[string, string]>)
      : []),
    ["core.hooksPath", devNull],
    ["core.symlinks", "false"],
    ["core.autocrlf", "false"],
    ["core.fsmonitor", "false"],
    ["protocol.allow", "never"],
    ["protocol.https.allow", "always"],
    ...(remote.scheme === "http" ? ([["protocol.http.allow", "always"]] as Array<[string, string]>) : []),
    ["submodule.recurse", "false"],
    // No automatic gc inside a commit that holds the tree lock; the sync runs
    // `git -c gc.auto=… gc --auto` instead.
    ["gc.auto", "0"],
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
  if (options.token) {
    env.MICA_GIT_USERNAME = options.username;
    env.MICA_GIT_TOKEN = options.token;
  }
  return env;
}

/**
 * Overrides `.gitattributes` so the bytes on disk are the bytes in Git. Write
 * it before the first checkout.
 */
export async function writeIsolationAttributes(gitDir: string): Promise<void> {
  const info = join(gitDir, "info");
  await mkdir(info, { recursive: true });
  await writeFile(join(info, "attributes"), "* -text -ident -filter -working-tree-encoding\n");
}

/**
 * `compact`: makes the clone on the data volume small again. The clone grows
 * with each media change on the website; a new clone has only the current
 * files. It runs only while Mica is stopped, and only without unpublished work.
 */

import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { ConfigError, createLogger } from "@micacms/runtime";

import { loadConfig } from "./config.js";
import { cloneLayout, CloneRefusal, openClone } from "./workspace/clone.js";
import { managedEnvironment } from "./workspace/isolation.js";
import { takeLease } from "./workspace/lease.js";
import { sizeOf } from "./workspace/managed.js";
import { draftPaths } from "./workspace/restore.js";

/** Compacts the clone, prints what it did, and returns the exit code. */
export async function runCompact(
  env: NodeJS.ProcessEnv = process.env,
  out: { write(text: string): unknown } = process.stdout,
): Promise<number> {
  const say = (line: string) => out.write(`${line}\n`);
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    say(error.message);
    return 78;
  }

  const logger = createLogger({ level: config.MICA_LOG_LEVEL, pretty: true });
  const { remote, branch, root, token, tokenFile, username } = config.repository;
  const layout = cloneLayout(config.dataDir);
  if (!existsSync(join(layout.repositoryDir, ".git"))) {
    say("There is no clone on the data volume. The next start makes one.");
    return 0;
  }

  try {
    // A running Mica holds the lease: this waits for it to stop, then refuses.
    const lease = await takeLease(config.dataDir, logger, () => {});
    try {
      const options = {
        layout,
        url: remote.url,
        branch,
        root,
        env: managedEnvironment({ remote, cloneDir: layout.repositoryDir, username, token, tokenFile }),
        logger,
      };
      const { git } = await openClone(options);
      const drafts = await draftPaths(git, "");
      const ahead = Number((await git.tryRun(["rev-list", "--count", `origin/${branch}..HEAD`])) ?? "0");
      if (drafts.length > 0 || ahead > 0) {
        say(
          `The clone holds work that is not published (${drafts.length} draft files${ahead > 0 ? ", one commit" : ""}).\n` +
            "Start Mica, and publish or discard the drafts. Then stop it, and compact again.",
        );
        return 1;
      }

      const before = await sizeOf(layout.repositoryDir);
      await rm(layout.repositoryDir, { recursive: true, force: true });
      await openClone(options);
      const after = await sizeOf(layout.repositoryDir);
      say(`Compacted the clone: ${megabytes(before)} before, ${megabytes(after)} now.`);
      return 0;
    } finally {
      await lease.release();
    }
  } catch (error) {
    if (!(error instanceof CloneRefusal)) throw error;
    say(error.message);
    return 78;
  }
}

function megabytes(bytes: number | null): string {
  return bytes === null ? "unknown" : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

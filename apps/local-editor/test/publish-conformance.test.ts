/** The developer policy against the publish conformance suite (#136), with a bare remote. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";

import { MANIFEST_PATH } from "@micacms/core/internal";
import { contentFiles, createLogger, createWorkingTreeStagingService } from "@micacms/runtime";

import { conformanceModel, conformanceSeed, describePublishConformance } from "../../../packages/runtime/test/publish-conformance.js";
import { developerPolicy } from "../src/developer.js";

const logger = createLogger({ level: "silent", pretty: false });
const directories: string[] = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function write(root: string, path: string, contents: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
}

describePublishConformance("the developer's checkout", async () => {
  const root = mkdtempSync(join(tmpdir(), "mica-conformance-"));
  const bare = mkdtempSync(join(tmpdir(), "mica-conformance-remote-"));
  directories.push(root, bare);
  git(bare, "init", "-q", "--bare", "-b", "main");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Developer");
  git(root, "config", "user.email", "developer@example.com");
  for (const [path, contents] of Object.entries(conformanceSeed)) write(root, path, contents);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Start");
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-q", "-u", "origin", "main");

  const contentRoot = join(root, "content");
  const files = contentFiles({ root: contentRoot });
  const service = createWorkingTreeStagingService({
    model: conformanceModel,
    files,
    contentRoot,
    schemaRevision: await files.revision(MANIFEST_PATH),
    logger,
    policy: developerPolicy({ publishEnabled: true, logger }),
  });

  return {
    service,
    write: (path, contents) => write(contentRoot, path, contents),
    lastCommit: () => ({
      paths: git(root, "show", "--name-only", "--format=", "HEAD").split("\n"),
      author: git(root, "log", "-1", "--format=%an <%ae>"),
      count: Number(git(root, "rev-list", "--count", "HEAD")),
    }),
    remoteHead: () => git(bare, "rev-parse", "main"),
    cutRemote: () => {
      renameSync(bare, `${bare}.away`);
      return () => renameSync(`${bare}.away`, bare);
    },
    // The developer's own Git identity: Mica leaves the author to Git.
    expectedAuthor: () => "Developer <developer@example.com>",
  };
});

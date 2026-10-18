/** The managed workspace against the publish conformance suite (#136), on the Git host of the tests. */

import { mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before } from "node:test";

import { MANIFEST_PATH } from "@micacms/core/internal";
import { contentFiles, createLogger, createWorkingTreeStagingService, createWorkspaceLocks } from "@micacms/runtime";

import { conformanceModel, conformanceSeed, describePublishConformance } from "../../../packages/runtime/test/publish-conformance.js";
import { cloneLayout, openClone } from "../src/workspace/clone.js";
import { contentGroups } from "../src/workspace/content-groups.js";
import { parseRemote } from "../src/workspace/credentials.js";
import { managedEnvironment } from "../src/workspace/isolation.js";
import { createManagedWorkspace } from "../src/workspace/managed.js";
import { devGit, seedRepository, startGitHost, writeIn, type GitHost } from "./git-http.js";

const TOKEN = "test-token-conformance";
const logger = createLogger({ level: "silent", pretty: false });

let host: GitHost;
let counter = 0;
before(async () => {
  host = await startGitHost(TOKEN);
});
after(async () => {
  await host.close();
});

describePublishConformance("the managed clone", async () => {
  const name = `conformance-${++counter}`;
  seedRepository(host, name, conformanceSeed);
  const layout = cloneLayout(mkdtempSync(join(tmpdir(), "mica-conformance-data-")));
  const remote = parseRemote(host.url(name));
  const env = managedEnvironment({ remote, cloneDir: layout.repositoryDir, username: "oauth2", token: TOKEN });
  const { git } = await openClone({ layout, url: remote.url, branch: "main", root: "content", env, logger });

  const contentRoot = join(layout.repositoryDir, "content");
  const tree = { git, prefix: "content", contentRoot };
  const files = contentFiles({ root: contentRoot });
  const locks = createWorkspaceLocks();
  const workspace = createManagedWorkspace({
    layout,
    url: remote.url,
    git,
    tree,
    branch: "main",
    root: "content",
    locks,
    logger,
    groupOf: contentGroups(conformanceModel),
    secrets: () => [TOKEN],
    syncSeconds: 60,
  });
  const service = createWorkingTreeStagingService({
    model: conformanceModel,
    files,
    contentRoot,
    schemaRevision: await files.revision(MANIFEST_PATH),
    logger,
    locks,
    tree,
    policy: workspace.policy,
  });

  const repo = layout.repositoryDir;
  const bare = host.bare(name);
  return {
    service,
    write: (path, contents) => writeIn(contentRoot, path, contents),
    lastCommit: () => ({
      paths: devGit(repo, "show", "--name-only", "--format=", "HEAD").split("\n"),
      author: devGit(repo, "log", "-1", "--format=%an <%ae>"),
      count: Number(devGit(repo, "rev-list", "--count", "HEAD")),
    }),
    remoteHead: () => devGit(bare, "rev-parse", "main"),
    cutRemote: () => {
      renameSync(bare, `${bare}.away`);
      return () => renameSync(`${bare}.away`, bare);
    },
    // The editor is the author, and Mica the committer.
    expectedAuthor: (editor) => `${editor.name} <${editor.email}>`,
  };
});

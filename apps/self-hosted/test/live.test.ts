/**
 * The managed workspace against github.com and gitlab.com, run weekly by the
 * `live-git` workflow. A host without a token or repository is skipped. Each
 * run publishes one commit to `content/live/run.json`.
 *
 *   MICA_LIVE_GITHUB_TOKEN, MICA_LIVE_GITHUB_REPO     owner/repo
 *   MICA_LIVE_GITLAB_TOKEN, MICA_LIVE_GITLAB_PROJECT  group/project
 *   MICA_LIVE_BRANCH    default `main`; the token must be allowed to push to it
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { commitPaths, createLogger, createWorkspaceLocks, gitRunner } from "@micacms/runtime";

import { cloneLayout, openClone } from "../src/workspace/clone.js";
import { defaultUsername, parseRemote } from "../src/workspace/credentials.js";
import { managedEnvironment } from "../src/workspace/isolation.js";
import { createManagedWorkspace } from "../src/workspace/managed.js";

const branch = process.env["MICA_LIVE_BRANCH"] || "main";
const logger = createLogger({ level: "warn", pretty: false });

const hosts = [
  {
    name: "github.com",
    token: process.env["MICA_LIVE_GITHUB_TOKEN"],
    project: process.env["MICA_LIVE_GITHUB_REPO"],
    url: (project: string) => `https://github.com/${project}.git`,
  },
  {
    name: "gitlab.com",
    token: process.env["MICA_LIVE_GITLAB_TOKEN"],
    project: process.env["MICA_LIVE_GITLAB_PROJECT"],
    url: (project: string) => `https://gitlab.com/${project}.git`,
  },
];

for (const host of hosts) {
  const skip = !host.token || !host.project ? `no token or repository configured for ${host.name}` : false;

  describe(`live: ${host.name}`, { skip }, () => {
    it("clones, publishes one commit and pushes it", async () => {
      const remote = parseRemote(host.url(host.project!));
      const dataDir = mkdtempSync(join(tmpdir(), "mica-live-"));
      try {
        const layout = cloneLayout(dataDir);
        const env = managedEnvironment({
          remote,
          cloneDir: layout.repositoryDir,
          username: defaultUsername(remote),
          token: host.token!,
        });
        const git = await openClone({ layout, url: remote.url, branch, root: "content", env, logger });
        const tree = { git, prefix: "content", contentRoot: join(layout.repositoryDir, "content") };
        const workspace = createManagedWorkspace({
          layout,
          url: remote.url,
          git,
          tree,
          branch,
          root: "content",
          locks: createWorkspaceLocks(),
          logger,
          groupOf: (path) => ({ key: path, label: path }),
          secrets: () => [host.token!],
          syncSeconds: 60,
        });

        const synced = await workspace.sync({ skipHold: true });
        assert.equal(synced.error, null, synced.error?.message);
        assert.equal((await workspace.checkWrite()).kind, "pushed");

        mkdirSync(join(tree.contentRoot, "live"), { recursive: true });
        writeFileSync(join(tree.contentRoot, "live", "run.json"), `${JSON.stringify({ at: new Date().toISOString() })}\n`);
        const revision = await commitPaths(tree, ["live/run.json"], `Live check ${new Date().toISOString()}`, {
          name: "Mica live check",
          email: "live@micacms.invalid",
        });

        const result = await workspace.policy.push(tree, revision);
        assert.equal(result.state, "published", result.pushError);

        // What the host now has on the branch is the commit Mica made.
        const remoteHead = await gitRunner(layout.repositoryDir, { env }).run(["ls-remote", "origin", `refs/heads/${branch}`]);
        assert.equal(remoteHead.split("\t")[0], result.revision);
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    });
  });
}

/** Git LFS in the managed clone, against a loopback Git host with the LFS API. Needs `git-lfs`. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ApiError, commitPaths, createLogger, createWorkspaceLocks, type GitRunner } from "@micacms/runtime";

import { cloneLayout, openClone, type CloneLayout } from "../src/workspace/clone.js";
import { parseRemote } from "../src/workspace/credentials.js";
import { managedEnvironment } from "../src/workspace/isolation.js";
import { createManagedWorkspace, type ManagedWorkspace } from "../src/workspace/managed.js";
import { draftPaths } from "../src/workspace/restore.js";
import { devGit, lfsPointer, seedRepository, startGitHost, storeLfsObject, writeIn, type GitHost } from "./git-http.js";

const TOKEN = "test-token-lfs-91d3";
const logger = createLogger({ level: "error", pretty: false });

const hasLfs = (() => {
  try {
    execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ATTRIBUTES = "content/**/*.png filter=lfs diff=lfs merge=lfs -text\npublic/*.png filter=lfs diff=lfs merge=lfs -text\n";
const SEED = {
  "content/.mica/schema.json": '{"protocolVersion":1}\n',
  "content/posts/a/index.json": '{"title":"A"}\n',
  ".gitattributes": ATTRIBUTES,
};

let host: GitHost;
let counter = 0;

before(async () => {
  host = await startGitHost(TOKEN);
});
after(async () => {
  await host.close();
});

interface Setup {
  name: string;
  layout: CloneLayout;
  git: GitRunner;
  repo: string;
  workspace: ManagedWorkspace;
}

/** Seeds `<name>.git`; `lfs` files are committed as pointers and their objects are put in the host's store. */
function seed(files: Record<string, string>, lfs: Record<string, Buffer>, stored = true): string {
  const name = `lfs-${++counter}`;
  const pointers = Object.fromEntries(Object.entries(lfs).map(([path, bytes]) => [path, lfsPointer(bytes).pointer]));
  seedRepository(host, name, { ...files, ...pointers });
  if (stored) for (const bytes of Object.values(lfs)) storeLfsObject(host, name, bytes);
  return name;
}

function cloneOptions(name: string, layout: CloneLayout) {
  const remote = parseRemote(host.url(name));
  const env = managedEnvironment({ remote, cloneDir: layout.repositoryDir, username: "oauth2", token: TOKEN });
  return { layout, url: remote.url, branch: "main", root: "content", env, logger };
}

async function setup(name: string): Promise<Setup> {
  const layout = cloneLayout(mkdtempSync(join(tmpdir(), "mica-data-")));
  const options = cloneOptions(name, layout);
  const { git } = await openClone(options);
  const workspace = createManagedWorkspace({
    layout,
    url: options.url,
    git,
    tree: { git, prefix: "content", contentRoot: join(layout.repositoryDir, "content") },
    branch: "main",
    root: "content",
    locks: createWorkspaceLocks(),
    logger,
    groupOf: (path) => ({ key: path.split("/").slice(0, 2).join("/"), label: path }),
    secrets: () => [TOKEN],
    syncSeconds: 60,
  });
  return { name, layout, git, repo: layout.repositoryDir, workspace };
}

/** A developer's push with Git LFS: the pointer in the commit, the object in the host's store. */
function pushUpstream(name: string, path: string, bytes: Buffer, stored = true): string {
  const checkout = mkdtempSync(join(tmpdir(), "mica-dev-"));
  devGit(checkout, "clone", "--quiet", host.bare(name), ".");
  writeIn(checkout, path, lfsPointer(bytes).pointer);
  if (stored) storeLfsObject(host, name, bytes);
  devGit(checkout, "add", "-A");
  devGit(checkout, "commit", "--quiet", "-m", `Add ${path}`);
  devGit(checkout, "push", "--quiet", "origin", "main");
  return devGit(checkout, "rev-parse", "HEAD");
}

const tree = (s: Setup) => ({ git: s.git, prefix: "content", contentRoot: join(s.repo, "content") });
const head = (s: Setup) => devGit(s.repo, "rev-parse", "HEAD");

describe("Git LFS in the clone", { skip: hasLfs ? false : "git-lfs is not installed" }, () => {
  it("downloads the LFS files under the content root, and keeps the pointers of the others", async () => {
    const photo = randomBytes(3000);
    const outside = randomBytes(3000);
    const s = await setup(seed(SEED, { "content/media/photo.png": photo, "public/logo.png": outside }));

    assert.deepEqual(readFileSync(join(s.repo, "content/media/photo.png")), photo);
    assert.equal(readFileSync(join(s.repo, "public/logo.png"), "utf8"), lfsPointer(outside).pointer);
    assert.deepEqual(await draftPaths(s.git, ""), []);
    assert.doesNotMatch(readFileSync(join(s.repo, ".git", "info", "attributes"), "utf8"), /-filter/);
  });

  it("downloads from the configured endpoint, whatever .lfsconfig says", async () => {
    const photo = randomBytes(2000);
    const lfsconfig = "[lfs]\n\turl = http://127.0.0.1:9/elsewhere/info/lfs\n\tpushurl = http://127.0.0.1:9/elsewhere/info/lfs\n";
    const s = await setup(seed({ ...SEED, ".lfsconfig": lfsconfig }, { "content/media/photo.png": photo }));
    assert.deepEqual(readFileSync(join(s.repo, "content/media/photo.png")), photo);
  });

  it("leaves no clone behind when an LFS file cannot be downloaded", async () => {
    const name = seed(SEED, { "content/media/missing.png": randomBytes(2000) }, false);
    const layout = cloneLayout(mkdtempSync(join(tmpdir(), "mica-data-")));
    await assert.rejects(openClone(cloneOptions(name, layout)));
    assert.deepEqual(readdirSync(layout.dataDir), ["volume.json"]);
  });

  it("brings in an LFS file with a sync", async () => {
    const s = await setup(seed(SEED, {}));
    const photo = randomBytes(2500);
    const to = pushUpstream(s.name, "content/media/new.png", photo);

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(head(s), to);
    assert.deepEqual(readFileSync(join(s.repo, "content/media/new.png")), photo);
  });

  it("holds a sync whose LFS files cannot be downloaded, and keeps the old version", async () => {
    const s = await setup(seed(SEED, {}));
    const before = head(s);
    pushUpstream(s.name, "content/media/lost.png", randomBytes(2500), false);

    const state = await s.workspace.sync();
    assert.equal(state.error?.code, "prefetch_incomplete");
    assert.match(state.error!.message, /Git LFS/);
    assert.equal(head(s), before);
    assert.ok(!existsSync(join(s.repo, "content/media/lost.png")));
  });

  it("publishes an upload as a pointer, and sends the object first", async () => {
    const s = await setup(seed(SEED, {}));
    const photo = randomBytes(4000);
    writeFileSync(join(s.repo, "content/posts/a/photo.png"), photo);
    const revision = await commitPaths(tree(s), ["posts/a/photo.png"], "Add a photo");

    host.lfsRequests.length = 0;
    const result = await s.workspace.policy.push(tree(s), revision);
    assert.equal(result.state, "published");
    assert.equal(devGit(host.bare(s.name), "show", "main:content/posts/a/photo.png") + "\n", lfsPointer(photo).pointer);
    const { oid } = lfsPointer(photo);
    assert.deepEqual(readFileSync(join(host.bare(s.name), "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid)), photo);
    assert.ok(host.lfsRequests.includes("PUT object"));
  });

  it("keeps a publication pending when the LFS store fails, and says so", async () => {
    const s = await setup(seed(SEED, {}));
    writeFileSync(join(s.repo, "content/posts/a/photo.png"), randomBytes(4000));
    const revision = await commitPaths(tree(s), ["posts/a/photo.png"], "Add a photo");
    const before = devGit(host.bare(s.name), "rev-parse", "main");

    host.lfsFails = true;
    try {
      const result = await s.workspace.policy.push(tree(s), revision);
      assert.equal(result.state, "committed-pending-push");
      assert.match(result.pushError ?? "", /^Git LFS could not send the files\./);
      assert.equal(devGit(host.bare(s.name), "rev-parse", "main"), before);
    } finally {
      host.lfsFails = false;
    }

    const state = await s.workspace.sync();
    assert.equal(state.pendingPush, null);
    assert.equal(devGit(host.bare(s.name), "rev-parse", "main"), revision);
  });

  it("turns a publication back into drafts when the host refuses the LFS upload", async () => {
    const s = await setup(seed(SEED, {}));
    writeFileSync(join(s.repo, "content/posts/a/photo.png"), randomBytes(4000));
    const revision = await commitPaths(tree(s), ["posts/a/photo.png"], "Add a photo");

    host.readOnly = true;
    try {
      await assert.rejects(s.workspace.policy.push(tree(s), revision), ApiError);
      assert.match(s.workspace.state().refused?.reason ?? "", /^Git LFS could not send the files\./);
      // Mica's own Git: without the LFS filter, the file would differ from its staged pointer.
      assert.equal(await s.git.run(["status", "--porcelain", "--", "content/posts"]), "A  content/posts/a/photo.png");
    } finally {
      host.readOnly = false;
    }
  });
});

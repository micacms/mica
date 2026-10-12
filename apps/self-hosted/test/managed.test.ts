/**
 * The managed workspace against a real Git host on loopback: the clone, sync
 * and its conflict check, "Keep my version" and "Use the website's version",
 * recovery after a crash, the push results, and the isolation of Git.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { ApiError, commitPaths, createLogger, createWorkspaceLocks, type GitRunner } from "@micacms/runtime";

import { cloneLayout, CloneRefusal, openClone, writeMarker, type CloneLayout } from "../src/workspace/clone.js";
import { parseRemote } from "../src/workspace/credentials.js";
import { managedEnvironment } from "../src/workspace/isolation.js";
import { createManagedWorkspace, type ContentGroup, type ManagedWorkspace } from "../src/workspace/managed.js";
import { devGit, refusePushes, seedRepository, startGitHost, writeIn, type GitHost } from "./git-http.js";

const TOKEN = "test-token-6f1c2a";
const logger = createLogger({ level: "error", pretty: false });

const SEED = {
  "content/.mica/schema.json": '{"protocolVersion":1}\n',
  "content/posts/a/index.json": '{"title":"A"}\n',
  "content/posts/a/body.mdoc": "Body of A\n",
  "content/posts/b/index.json": '{"title":"B"}\n',
  "content/posts/_order.json": '["a","b"]\n',
  "content/theme.json": '{"color":"red"}\n',
  "src/pages/index.astro": "---\n---\n",
};

/** The test model's groups: an entry is `collection/slug`, a file at the top is itself. */
function groupOf(path: string): ContentGroup {
  const [first, second] = path.split("/");
  if (second === undefined) return { key: first!.replace(/\.json$/, ""), label: first! };
  const key = second === "_order.json" ? `${first}/_order` : `${first}/${second.replace(/\.json$/, "")}`;
  return { key, label: key };
}

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
  developer: string;
  layout: CloneLayout;
  git: GitRunner;
  repo: string;
  workspace: ManagedWorkspace;
  open(): Promise<GitRunner>;
}

async function setup(token = TOKEN, files: Record<string, string> = SEED): Promise<Setup> {
  const name = `site-${++counter}`;
  const developer = seedRepository(host, name, files);
  const dataDir = mkdtempSync(join(tmpdir(), "mica-data-"));
  const layout = cloneLayout(dataDir);
  const remote = parseRemote(host.url(name), true);
  const env = managedEnvironment({ remote, cloneDir: layout.repositoryDir, username: "oauth2", token });
  const open = () => openClone({ layout, url: remote.url, branch: "main", root: "content", env, logger });
  const git = await open();
  const workspace = createManagedWorkspace({
    layout,
    url: remote.url,
    git,
    tree: { git, prefix: "content", contentRoot: join(layout.repositoryDir, "content") },
    branch: "main",
    root: "content",
    locks: createWorkspaceLocks(),
    logger,
    groupOf,
    secrets: [token],
    syncSeconds: 60,
  });
  return { name, developer, layout, git, repo: layout.repositoryDir, workspace, open };
}

/** Commits and pushes a change from the developer's checkout. */
function upstream(s: Setup, change: (dir: string) => void, message = "Upstream change"): string {
  change(s.developer);
  devGit(s.developer, "add", "-A");
  devGit(s.developer, "commit", "--quiet", "-m", message);
  devGit(s.developer, "push", "--quiet", "origin", "main");
  return devGit(s.developer, "rev-parse", "HEAD");
}

/** Every file under `dir` whose bytes contain `text`. */
function filesContaining(dir: string, text: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (readFileSync(path).includes(text)) found.push(path);
  }
  return found;
}

const read = (s: Setup, path: string) => readFileSync(join(s.repo, path), "utf8");
const head = (s: Setup) => devGit(s.repo, "rev-parse", "HEAD");

describe("the clone", () => {
  it("is blobless, keeps no credential, and overrides the repository's attributes", async () => {
    const s = await setup();
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"A"}\n');
    assert.equal(devGit(s.repo, "config", "--get", "remote.origin.partialclonefilter"), "blob:none");
    const config = readFileSync(join(s.repo, ".git", "config"), "utf8");
    assert.ok(!config.includes(TOKEN), "the token is in .git/config");
    assert.equal(filesContaining(s.layout.dataDir, TOKEN).length, 0, "the token is in a file on the volume");
    assert.match(readFileSync(join(s.repo, ".git", "info", "attributes"), "utf8"), /-ident -filter/);
    assert.ok(host.authorizations.some((header) => header.startsWith("Basic ")));
  });

  it("is cloned again when the URL changed and it holds no work", async () => {
    const s = await setup();
    seedRepository(host, `${s.name}-other`, { ...SEED, "content/theme.json": '{"color":"blue"}\n' });
    const remote = parseRemote(host.url(`${s.name}-other`), true);
    const env = managedEnvironment({ remote, cloneDir: s.repo, username: "oauth2", token: TOKEN });
    await openClone({ layout: s.layout, url: remote.url, branch: "main", root: "content", env, logger });
    assert.equal(read(s, "content/theme.json"), '{"color":"blue"}\n');
  });

  it("refuses to start when the URL changed and it holds a draft", async () => {
    const s = await setup();
    writeIn(s.repo, "content/theme.json", '{"color":"draft"}\n');
    seedRepository(host, `${s.name}-moved`, SEED);
    const remote = parseRemote(host.url(`${s.name}-moved`), true);
    const env = managedEnvironment({ remote, cloneDir: s.repo, username: "oauth2", token: TOKEN });
    await assert.rejects(
      openClone({ layout: s.layout, url: remote.url, branch: "main", root: "content", env, logger }),
      (error: unknown) => error instanceof CloneRefusal && /content\/theme\.json/.test((error as Error).message),
    );
    assert.equal(read(s, "content/theme.json"), '{"color":"draft"}\n');
  });

  it("refuses Git LFS under the content root", async () => {
    await assert.rejects(
      setup(TOKEN, { ...SEED, ".gitattributes": "content/**/*.jpg filter=lfs diff=lfs merge=lfs -text\n" }),
      CloneRefusal,
    );
  });

  it("allows Git LFS outside the content root", async () => {
    const s = await setup(TOKEN, { ...SEED, ".gitattributes": "/public/**/*.jpg filter=lfs diff=lfs merge=lfs -text\n" });
    assert.ok(existsSync(join(s.repo, "content/theme.json")));
  });

  it("checks out a symlink as a plain file, and does not expand $Id$", async () => {
    const s = await setup(TOKEN, {
      ...SEED,
      ".gitattributes": "*.json ident\n",
      "content/id.json": '{"id":"$Id$"}\n',
    });
    assert.equal(read(s, "content/id.json"), '{"id":"$Id$"}\n');

    upstream(s, (dir) => symlinkSync("/etc/passwd", join(dir, "content", "link.json")));
    await s.workspace.sync();
    assert.ok(lstatSync(join(s.repo, "content", "link.json")).isFile());
    assert.equal(read(s, "content/link.json"), "/etc/passwd");
  });
});

describe("sync", () => {
  it("fast-forwards past an upstream change and keeps a draft elsewhere byte for byte", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"A, edited"}\n');
    writeIn(s.repo, "content/posts/c/index.json", '{"title":"New"}\n');
    const to = upstream(s, (dir) => writeIn(dir, "content/posts/b/index.json", '{"title":"B, upstream"}\n'));

    const state = await s.workspace.sync();
    assert.equal(state.error, null);
    assert.deepEqual(state.conflicts, []);
    assert.equal(head(s), to);
    assert.equal(read(s, "content/posts/b/index.json"), '{"title":"B, upstream"}\n');
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"A, edited"}\n');
    assert.equal(read(s, "content/posts/c/index.json"), '{"title":"New"}\n');
    assert.ok(!existsSync(s.layout.operationFile));
  });

  const cases: Array<{
    name: string;
    draft: (repo: string) => void;
    change: (dir: string) => void;
    group: string;
    upstream: "changed" | "deleted" | "added";
  }> = [
    {
      name: "an untracked draft against an upstream add",
      draft: (repo) => writeIn(repo, "content/posts/c/index.json", '{"title":"Mine"}\n'),
      change: (dir) => writeIn(dir, "content/posts/c/index.json", '{"title":"Theirs"}\n'),
      group: "posts/c",
      upstream: "added",
    },
    {
      name: "an edit against an edit",
      draft: (repo) => writeIn(repo, "content/posts/a/index.json", '{"title":"Mine"}\n'),
      change: (dir) => writeIn(dir, "content/posts/a/index.json", '{"title":"Theirs"}\n'),
      group: "posts/a",
      upstream: "changed",
    },
    {
      name: "a local deletion against an upstream edit",
      draft: (repo) => rmSync(join(repo, "content/posts/b/index.json")),
      change: (dir) => writeIn(dir, "content/posts/b/index.json", '{"title":"Theirs"}\n'),
      group: "posts/b",
      upstream: "changed",
    },
    {
      name: "an upstream deletion against a local edit",
      draft: (repo) => writeIn(repo, "content/posts/b/index.json", '{"title":"Mine"}\n'),
      change: (dir) => rmSync(join(dir, "content/posts/b"), { recursive: true }),
      group: "posts/b",
      upstream: "deleted",
    },
    {
      name: "an upstream rename against a local edit",
      draft: (repo) => writeIn(repo, "content/posts/a/index.json", '{"title":"Mine"}\n'),
      change: (dir) => devGit(dir, "mv", "content/posts/a", "content/posts/a2"),
      group: "posts/a",
      upstream: "deleted",
    },
    {
      name: "a local index.json against an upstream body of the same entry",
      draft: (repo) => writeIn(repo, "content/posts/a/index.json", '{"title":"Mine"}\n'),
      change: (dir) => writeIn(dir, "content/posts/a/body.mdoc", "Their body\n"),
      group: "posts/a",
      upstream: "changed",
    },
    {
      name: "a draft inside an ignored directory against an upstream add",
      draft: (repo) => {
        writeIn(repo, ".gitignore", "content/cache/\n");
        writeIn(repo, "content/cache/g.json", '{"mine":true}\n');
      },
      change: (dir) => {
        writeIn(dir, "content/cache/g.json", '{"theirs":true}\n');
        devGit(dir, "add", "--force", "content/cache/g.json");
      },
      group: "cache/g",
      upstream: "added",
    },
  ];

  for (const testCase of cases) {
    it(`reports a conflict for ${testCase.name}, and changes nothing`, async () => {
      const s = await setup();
      testCase.draft(s.repo);
      const before = head(s);
      const drafts = devGit(s.repo, "status", "--porcelain", "-uall", "--ignored");
      upstream(s, testCase.change);

      const state = await s.workspace.sync();
      assert.equal(state.error, null);
      assert.deepEqual(
        state.conflicts.map((conflict) => [conflict.key, conflict.upstream]),
        [[testCase.group, testCase.upstream]],
      );
      assert.equal(head(s), before, "the clone moved");
      assert.equal(devGit(s.repo, "status", "--porcelain", "-uall", "--ignored"), drafts, "a draft changed");
      assert.equal(s.workspace.policy.publishAvailability().enabled, false);
    });
  }

  it("holds at a model change, and a start applies it", async () => {
    const s = await setup();
    const before = head(s);
    const to = upstream(s, (dir) => writeIn(dir, "content/.mica/schema.json", '{"protocolVersion":1,"x":1}\n'));

    const held = await s.workspace.sync();
    assert.equal(held.restartRequired, true);
    assert.equal(head(s), before);

    const started = await s.workspace.sync({ skipHold: true });
    assert.equal(started.error, null);
    assert.equal(head(s), to);
  });

  it("reports an authentication failure without the token", async () => {
    const s = await setup();
    const remote = parseRemote(host.url(s.name), true);
    const env = managedEnvironment({ remote, cloneDir: s.repo, username: "oauth2", token: "wrong-token-123" });
    const git = await openClone({ layout: s.layout, url: remote.url, branch: "main", root: "content", env, logger });
    const workspace = createManagedWorkspace({
      layout: s.layout,
      url: remote.url,
      git,
      tree: { git, prefix: "content", contentRoot: join(s.repo, "content") },
      branch: "main",
      root: "content",
      locks: createWorkspaceLocks(),
      logger,
      groupOf,
      secrets: ["wrong-token-123"],
      syncSeconds: 60,
    });
    const state = await workspace.sync();
    assert.equal(state.error?.code, "auth");
    assert.ok(!state.error.message.includes("wrong-token-123"));
  });
});

describe("what the editor sees", () => {
  it("reports a conflict with its group, label and comparison target, and describes the clone", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Mine"}\n');
    upstream(s, (dir) => writeIn(dir, "content/posts/a/index.json", '{"title":"Theirs"}\n'));
    await s.workspace.sync();

    const status = s.workspace.policy.syncStatus!();
    assert.equal(status.conflicts.length, 1);
    assert.equal(status.conflicts[0]!.group, "posts/a");
    assert.equal(status.conflicts[0]!.upstream, "changed");
    assert.ok(status.lastSyncAt);
    assert.equal(s.workspace.policy.upstreamRef, "origin/main");

    const described = await s.workspace.policy.describe!();
    assert.equal(described.url, host.url(s.name));
    assert.ok((described.cloneBytes ?? 0) > 0);
  });
});

describe("resolving a conflict", () => {
  async function conflicted() {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Mine"}\n');
    const to = upstream(s, (dir) => writeIn(dir, "content/posts/a/index.json", '{"title":"Theirs"}\n'));
    await s.workspace.sync();
    return { s, to };
  }

  it("keeps my version on top of the website's", async () => {
    const { s, to } = await conflicted();
    const state = await s.workspace.resolve("posts/a", "mine");
    assert.deepEqual(state.conflicts, []);
    assert.equal(head(s), to);
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"Mine"}\n');
    assert.match(devGit(s.repo, "status", "--porcelain"), /content\/posts\/a\/index\.json/);
    assert.ok(!existsSync(s.layout.keepMineFile));
    assert.ok(!existsSync(s.layout.rescueDir));
  });

  it("takes the website's version", async () => {
    const { s, to } = await conflicted();
    const state = await s.workspace.resolve("posts/a", "website");
    assert.deepEqual(state.conflicts, []);
    assert.equal(head(s), to);
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"Theirs"}\n');
    assert.equal(devGit(s.repo, "status", "--porcelain"), "");
  });
});

describe("recovery at start", () => {
  it("finishes a fast-forward that stopped after the checkout and keeps the drafts", async () => {
    const s = await setup();
    const from = head(s);
    const to = upstream(s, (dir) => {
      writeIn(dir, "content/posts/b/index.json", '{"title":"B2"}\n');
      rmSync(join(dir, "content/theme.json"));
      writeIn(dir, "content/posts/tour[1]/index.json", '{"title":"Brackets"}\n');
    });
    writeIn(s.repo, "content/posts/tour1/index.json", '{"title":"My draft"}\n');

    // The crash: the files and the index moved, the branch did not.
    await s.git.run(["fetch", "--quiet", "origin"]);
    await s.git.run(["read-tree", "-m", "-u", from, to]);
    await writeMarker(s.layout.operationFile, { from, to });

    await s.open();
    assert.equal(head(s), to);
    assert.equal(read(s, "content/posts/tour1/index.json"), '{"title":"My draft"}\n');
    assert.equal(devGit(s.repo, "status", "--porcelain", "-uall"), "?? content/posts/tour1/index.json");
    assert.ok(!existsSync(s.layout.operationFile));
  });

  it("removes an old index.lock and keeps a young one", async () => {
    const s = await setup();
    const lock = join(s.repo, ".git", "index.lock");
    writeFileSync(lock, "");
    await s.open();
    assert.ok(existsSync(lock), "a young lock was removed");

    const old = new Date(Date.now() - 60 * 60_000);
    utimesSync(lock, old, old);
    await s.open();
    assert.ok(!existsSync(lock), "an old lock stayed");
  });

  it("deletes the temporary files of an interrupted save", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json.mica-123-0", "half");
    await s.open();
    assert.ok(!existsSync(join(s.repo, "content/posts/a/index.json.mica-123-0")));
  });
});

describe("publishing", () => {
  const tree = (s: Setup) => ({ git: s.git, prefix: "content", contentRoot: join(s.repo, "content") });
  const editor = { name: "Erika Editor", email: "erika@example.com" };

  it("pushes with the editor as author and Mica as committer", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Published"}\n');
    const revision = await commitPaths(tree(s), ["posts/a/index.json"], "Edit A", editor);

    const result = await s.workspace.policy.push(tree(s), revision);
    assert.equal(result.state, "published");
    const published = devGit(host.bare(s.name), "log", "-1", "--format=%an <%ae>|%cn", "main");
    assert.equal(published, "Erika Editor <erika@example.com>|Mica CMS");
  });

  it("makes a publication again on top of a competing push", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Mine"}\n');
    writeIn(s.repo, "content/posts/new/index.json", '{"title":"New"}\n');
    const revision = await commitPaths(tree(s), ["posts/a/index.json", "posts/new/index.json"], "Edit A", editor);
    const theirs = upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"green"}\n'));

    const result = await s.workspace.policy.push(tree(s), revision);
    assert.equal(result.state, "published");
    const bare = host.bare(s.name);
    assert.equal(devGit(bare, "rev-parse", "main^"), theirs);
    assert.equal(devGit(bare, "log", "-1", "--format=%an|%s", "main"), "Erika Editor|Edit A");
    assert.equal(devGit(bare, "show", "main:content/posts/new/index.json"), '{"title":"New"}');
    assert.equal(devGit(bare, "show", "main:content/theme.json"), '{"color":"green"}');
  });

  it("does not publish an autosave that landed after the commit, when it has to make the commit again", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Reviewed"}\n');
    const revision = await commitPaths(tree(s), ["posts/a/index.json"], "Edit A", editor);
    upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"green"}\n'));
    // Saved again after the commit, before the push went through.
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Not reviewed"}\n');

    await assert.rejects(s.workspace.policy.push(tree(s), revision), ApiError);
    assert.notEqual(devGit(host.bare(s.name), "show", "main:content/posts/a/index.json"), '{"title":"Not reviewed"}');
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"Not reviewed"}\n');
  });

  it("turns a publication the host refuses back into drafts", async () => {
    const s = await setup();
    refusePushes(host, s.name, "GitLab: You are not allowed to push code to protected branches on this project.");
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Mine"}\n');
    const before = head(s);
    const revision = await commitPaths(tree(s), ["posts/a/index.json"], "Edit A", editor);

    await assert.rejects(s.workspace.policy.push(tree(s), revision), ApiError);
    assert.equal(head(s), before);
    assert.equal(devGit(s.repo, "status", "--porcelain"), "M  content/posts/a/index.json");
    assert.match(s.workspace.state().refused?.reason ?? "", /protected branches/);
    rmSync(join(host.bare(s.name), "hooks", "pre-receive"));
  });

  it("turns a publication back into drafts when the token cannot write", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Mine"}\n');
    const revision = await commitPaths(tree(s), ["posts/a/index.json"], "Edit A", editor);
    host.readOnly = true;
    try {
      await assert.rejects(s.workspace.policy.push(tree(s), revision), ApiError);
      assert.equal(devGit(s.repo, "status", "--porcelain"), "M  content/posts/a/index.json");
      assert.equal((await s.workspace.checkWrite()).kind, "failed");
    } finally {
      host.readOnly = false;
    }
  });

  it("keeps a publication pending when the host cannot be reached, and a sync pushes it", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Mine"}\n');
    const revision = await commitPaths(tree(s), ["posts/a/index.json"], "Edit A", editor);

    const bare = host.bare(s.name);
    const moved = `${bare}.away`;
    renameSync(bare, moved);
    const pending = await s.workspace.policy.push(tree(s), revision);
    renameSync(moved, bare);
    assert.equal(pending.state, "committed-pending-push");

    const state = await s.workspace.sync();
    assert.equal(state.pendingPush, null);
    assert.equal(devGit(bare, "rev-parse", "main"), revision);
  });
});

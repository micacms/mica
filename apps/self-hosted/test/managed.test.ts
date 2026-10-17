/** The managed workspace against a real Git host on loopback. */

import assert from "node:assert/strict";
import {
  cpSync,
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

import { ApiError, commitPaths, createLogger, createWorkspaceLocks, gitRunner, type GitRunner } from "@micacms/runtime";

import { cloneLayout, CloneRefusal, openClone, writeMarker, type CloneLayout } from "../src/workspace/clone.js";
import { parseRemote } from "../src/workspace/credentials.js";
import { managedEnvironment } from "../src/workspace/isolation.js";
import { createManagedWorkspace, type ContentGroup, type ManagedWorkspace } from "../src/workspace/managed.js";
import { draftPaths } from "../src/workspace/restore.js";
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

async function setup(
  token = TOKEN,
  files: Record<string, string> = SEED,
  onModelChange?: () => Promise<void>,
  modelProblem?: (manifest: string) => Promise<string | null>,
): Promise<Setup> {
  const name = `site-${++counter}`;
  const developer = seedRepository(host, name, files);
  const dataDir = mkdtempSync(join(tmpdir(), "mica-data-"));
  const layout = cloneLayout(dataDir);
  const remote = parseRemote(host.url(name));
  const env = managedEnvironment({ remote, cloneDir: layout.repositoryDir, username: "oauth2", token });
  const open = async () => (await openClone({ layout, url: remote.url, branch: "main", root: null, env, logger })).git;
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
    secrets: () => [token],
    syncSeconds: 60,
    ...(onModelChange ? { onModelChange } : {}),
    ...(modelProblem ? { modelProblem } : {}),
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
    assert.match(readFileSync(join(s.repo, ".git", "info", "attributes"), "utf8"), /-text -ident -working-tree-encoding/);
    assert.ok(host.authorizations.some((header) => header.startsWith("Basic ")));
  });

  it("keeps the clone and its draft when the repository moved to a new URL", async () => {
    const s = await setup();
    writeIn(s.repo, "content/theme.json", '{"color":"draft"}\n');
    cpSync(host.bare(s.name), host.bare(`${s.name}-moved`), { recursive: true });
    const remote = parseRemote(host.url(`${s.name}-moved`));
    const env = managedEnvironment({ remote, cloneDir: s.repo, username: "oauth2", token: TOKEN });
    const before = head(s);
    await openClone({ layout: s.layout, url: remote.url, branch: "main", root: null, env, logger });
    assert.equal(devGit(s.repo, "config", "--get", "remote.origin.url"), remote.url);

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(head(s), before);
    assert.equal(read(s, "content/theme.json"), '{"color":"draft"}\n');
  });

  it("follows a new URL with another history, and keeps the drafts as conflicts", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Draft"}\n');
    seedRepository(host, `${s.name}-other`, { ...SEED, "content/theme.json": '{"color":"blue"}\n' });
    const remote = parseRemote(host.url(`${s.name}-other`));
    const env = managedEnvironment({ remote, cloneDir: s.repo, username: "oauth2", token: TOKEN });
    await openClone({ layout: s.layout, url: remote.url, branch: "main", root: null, env, logger });

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(read(s, "content/theme.json"), '{"color":"blue"}\n');
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"Draft"}\n');
    assert.deepEqual(state.conflicts.map((conflict) => conflict.key), ["posts/a"]);
  });

  it("runs no filter that the repository names, other than Git LFS", async () => {
    const s = await setup(TOKEN, { ...SEED, ".gitattributes": "*.json filter=upper\n" });
    assert.equal(read(s, "content/theme.json"), '{"color":"red"}\n');
    assert.deepEqual(await draftPaths(s.git, ""), []);
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

describe("a content repository that a website includes as a submodule", () => {
  /** Clones `files` as the only repository, as Mica does for MICA_REPOSITORY_URL. */
  const cloneOf = async (files: Record<string, string>) => {
    const name = `content-${++counter}`;
    seedRepository(host, name, files);
    const layout = cloneLayout(mkdtempSync(join(tmpdir(), "mica-data-")));
    const remote = parseRemote(host.url(name));
    const env = managedEnvironment({ remote, cloneDir: layout.repositoryDir, username: "oauth2", token: TOKEN });
    return openClone({ layout, url: remote.url, branch: "main", root: null, env, logger });
  };

  it("finds the content root in a folder of it", async () => {
    const { root } = await cloneOf({
      "README.md": "The content of the website.\n",
      "site/.mica/schema.json": '{"protocolVersion":1}\n',
      "site/posts/a/index.json": '{"title":"A"}\n',
    });
    assert.equal(root, "site");
  });

  // The rule of #227: the content root holds no `.git`. A submodule whose root is the content root needs a folder for Mica.
  it("refuses it when its top is the content root", async () => {
    await assert.rejects(
      cloneOf({ ".mica/schema.json": '{"protocolVersion":1}\n', "posts/a/index.json": '{"title":"A"}\n' }),
      (error: unknown) => error instanceof CloneRefusal && /at the top of the repository/.test(error.message),
    );
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

  it("fast-forwards over several upstream commits that change the same file", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Mine"}\n');
    upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"one"}\n'), "First");
    const to = upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"two"}\n'), "Second");

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(head(s), to);
    assert.equal(read(s, "content/theme.json"), '{"color":"two"}\n');
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"Mine"}\n');
  });

  /** A developer rewrites the branch: the clone's head is no longer on it. */
  function rewrite(s: Setup, color: string): string {
    devGit(s.developer, "fetch", "--quiet", "origin");
    devGit(s.developer, "reset", "--hard", "--quiet", "origin/main^");
    writeIn(s.developer, "content/theme.json", `{"color":"${color}"}\n`);
    devGit(s.developer, "commit", "--quiet", "-am", "Rewritten");
    devGit(s.developer, "push", "--quiet", "--force", "origin", "HEAD:main");
    return devGit(s.developer, "rev-parse", "HEAD");
  }

  it("follows a rewritten branch", async () => {
    const s = await setup();
    upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"one"}\n'));
    await s.workspace.sync();
    const to = rewrite(s, "rewritten");

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(head(s), to);
    assert.equal(read(s, "content/theme.json"), '{"color":"rewritten"}\n');
    assert.deepEqual(state.conflicts, []);
  });

  it("keeps the drafts on a rewritten branch as conflicts until an editor chooses", async () => {
    const s = await setup();
    upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"one"}\n'));
    await s.workspace.sync();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Draft"}\n');
    writeIn(s.repo, "content/posts/new/index.json", '{"title":"New"}\n');
    rewrite(s, "rewritten");

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"Draft"}\n');
    assert.equal(read(s, "content/posts/new/index.json"), '{"title":"New"}\n');
    assert.deepEqual(state.conflicts.map((conflict) => conflict.key).sort(), ["posts/a", "posts/new"]);
    assert.equal(s.workspace.policy.publishAvailability().enabled, false);
    // A timed sync does not clear them.
    assert.equal((await s.workspace.sync()).conflicts.length, 2);

    assert.equal((await s.workspace.resolve("posts/a", "website")).conflicts.length, 1);
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"A"}\n');
    assert.deepEqual((await s.workspace.resolve("posts/new", "mine")).conflicts, []);
    assert.equal(read(s, "content/posts/new/index.json"), '{"title":"New"}\n');
  });

  it("keeps a publication that never reached the host when the branch is rewritten", async () => {
    const s = await setup();
    upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"one"}\n'));
    await s.workspace.sync();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Unpushed"}\n');
    const tree = { git: s.git, prefix: "content", contentRoot: join(s.repo, "content") };
    await commitPaths(tree, ["posts/a/index.json"], "Edit A", { name: "E", email: "e@example.com" });
    const to = rewrite(s, "rewritten");

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(head(s), to);
    assert.equal(read(s, "content/posts/a/index.json"), '{"title":"Unpushed"}\n');
    assert.deepEqual(state.conflicts.map((conflict) => conflict.key), ["posts/a"]);
  });

  it("does not push again a publication that a force push took back", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Published"}\n');
    const tree = { git: s.git, prefix: "content", contentRoot: join(s.repo, "content") };
    const revision = await commitPaths(tree, ["posts/a/index.json"], "Edit A", { name: "E", email: "e@example.com" });
    assert.equal((await s.workspace.policy.push(tree, revision)).state, "published");

    // A developer takes the publication back.
    devGit(s.developer, "fetch", "--quiet", "origin");
    devGit(s.developer, "reset", "--hard", "--quiet", `${revision}^`);
    devGit(s.developer, "push", "--quiet", "--force", "origin", "HEAD:main");

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.notEqual(devGit(host.bare(s.name), "rev-parse", "main"), revision);
    assert.notEqual(read(s, "content/posts/a/index.json"), '{"title":"Published"}\n');
    assert.deepEqual(state.conflicts, []);
  });

  it("reads an upstream file whose name starts with a colon", async () => {
    const s = await setup();
    const to = upstream(s, (dir) => writeIn(dir, "content/:notes.md", "colon\n"));
    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(head(s), to);
  });

  it("brings in an attributes change without a restart", async () => {
    const s = await setup();
    const plain = upstream(s, (dir) => writeIn(dir, "content/.gitattributes", "*.txt text\n"));
    assert.equal((await s.workspace.sync()).error, null);
    assert.equal(head(s), plain);
  });

  it("holds a new model that this image cannot read, unless the start has no other", async () => {
    const s = await setup(TOKEN, SEED, undefined, async (manifest) => (manifest.includes('"x":2') ? "too new" : null));
    const before = head(s);
    const to = upstream(s, (dir) => writeIn(dir, "content/.mica/schema.json", '{"protocolVersion":1,"x":2}\n'));
    const held = await s.workspace.sync();
    assert.equal(held.error?.code, "model_unreadable");
    assert.match(held.error!.message, /too new/);
    assert.equal(head(s), before);

    assert.equal((await s.workspace.sync({ skipHold: true })).error, null);
    assert.equal(head(s), to);
  });

  it("brings a model change in at once, and tells the app", async () => {
    let told = 0;
    const s = await setup(TOKEN, SEED, async () => {
      told += 1;
    });
    const to = upstream(s, (dir) => writeIn(dir, "content/.mica/schema.json", '{"protocolVersion":1,"x":1}\n'));

    const state = await s.workspace.sync();
    assert.equal(state.error, null, state.error?.message);
    assert.equal(head(s), to);
    assert.equal(told, 1);
  });

  it("reports an authentication failure without the token", async () => {
    const s = await setup();
    const remote = parseRemote(host.url(s.name));
    const env = managedEnvironment({ remote, cloneDir: s.repo, username: "oauth2", token: "wrong-token-123" });
    const { git } = await openClone({ layout: s.layout, url: remote.url, branch: "main", root: null, env, logger });
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
      secrets: () => ["wrong-token-123"],
      syncSeconds: 60,
    });
    const state = await workspace.sync();
    assert.equal(state.error?.code, "auth");
    assert.ok(!state.error.message.includes("wrong-token-123"));
  });
});

describe("the credential helper", () => {
  it("gives the token to the configured host only", async () => {
    const s = await setup();
    const other = await startGitHost("another-token-77");
    try {
      seedRepository(other, "elsewhere", SEED);
      const remote = parseRemote(host.url(s.name));
      const env = managedEnvironment({ remote, cloneDir: s.repo, username: "oauth2", token: TOKEN });
      await assert.rejects(gitRunner(s.repo, { env }).run(["ls-remote", other.url("elsewhere")]));
      const leaked = other.authorizations.filter((header) =>
        Buffer.from(header.replace(/^Basic /, ""), "base64").toString().includes(TOKEN),
      );
      assert.deepEqual(leaked, []);
    } finally {
      await other.close();
    }
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

  it("removes a clone that a crash left half-made, and clones again", async () => {
    const s = await setup();
    rmSync(s.repo, { recursive: true, force: true });
    const leftover = `${s.repo}.unfinished-99999`;
    devGit(s.layout.dataDir, "init", "--quiet", leftover);
    await s.open();
    assert.ok(!existsSync(leftover));
    assert.ok(existsSync(join(s.repo, "content/theme.json")));
  });

  it("refuses a volume with another layout version", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mica-data-"));
    writeFileSync(join(dataDir, "volume.json"), '{"version":2}');
    const layout = cloneLayout(dataDir);
    const remote = parseRemote(host.url(`site-${counter}`));
    const env = managedEnvironment({ remote, cloneDir: layout.repositoryDir, username: "oauth2", token: TOKEN });
    await assert.rejects(openClone({ layout, url: remote.url, branch: "main", root: null, env, logger }), /layout version 2/);
  });

  it("refuses to clone again while the rescue directory holds drafts", async () => {
    const s = await setup();
    await writeMarker(s.layout.keepMineFile, { files: {} });
    rmSync(s.repo, { recursive: true, force: true });
    await assert.rejects(s.open(), CloneRefusal);
  });

  // The start holds the volume's lease, so no other process owns a lock (#229).
  it("removes every lock file that a stop or a crash left", async () => {
    const s = await setup();
    const locks = [join(s.repo, ".git", "index.lock"), join(s.repo, ".git", "refs", "heads", "main.lock")];
    for (const lock of locks) writeFileSync(lock, "");
    await s.open();
    for (const lock of locks) assert.ok(!existsSync(lock), lock);
  });

  it("deletes the temporary files of an interrupted save", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json.mica-123-0", "half");
    await s.open();
    assert.ok(!existsSync(join(s.repo, "content/posts/a/index.json.mica-123-0")));
  });
});

describe("a fast-forward that cannot be undone (#229)", () => {
  it("makes the clone read-only until a restart, and keeps the marker for the start", async () => {
    const s = await setup();
    // Git fails in the fast-forward and again in its rollback, as with a full disk.
    const failing: GitRunner = {
      run: (args, call) => (args[0] === "merge" || args[0] === "restore" ? Promise.reject(new Error("No space left on device")) : s.git.run(args, call)),
      tryRun: (args, call) => s.git.tryRun(args, call),
    };
    const workspace = createManagedWorkspace({
      layout: s.layout,
      url: host.url(s.name),
      git: failing,
      tree: { git: failing, prefix: "content", contentRoot: join(s.repo, "content") },
      branch: "main",
      root: "content",
      locks: createWorkspaceLocks(),
      logger,
      groupOf,
      secrets: () => [TOKEN],
      syncSeconds: 60,
    });
    upstream(s, (dir) => writeIn(dir, "content/posts/b/index.json", '{"title":"B, upstream"}\n'));

    const state = await workspace.sync();
    assert.match(state.readOnly ?? "", /restarts it/);
    assert.equal(workspace.policy.publishAvailability().enabled, false);
    assert.ok(existsSync(s.layout.operationFile), "the start must find the marker");
    // No second attempt while the clone is between two versions.
    assert.equal((await workspace.sync()).readOnly, state.readOnly);
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

  it("makes a deletion again on top of a competing push", async () => {
    const s = await setup();
    rmSync(join(s.repo, "content/posts/b"), { recursive: true });
    const revision = await commitPaths(tree(s), ["posts/b/index.json"], "Delete B", editor);
    upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"green"}\n'));

    const result = await s.workspace.policy.push(tree(s), revision);
    assert.equal(result.state, "published");
    assert.equal(devGit(host.bare(s.name), "ls-tree", "--name-only", "main", "content/posts/"), "content/posts/_order.json\ncontent/posts/a");
  });

  it("publishes a refused deletion once the host accepts it", async () => {
    const s = await setup();
    refusePushes(host, s.name, "protected");
    rmSync(join(s.repo, "content/posts/b"), { recursive: true });
    const refused = await commitPaths(tree(s), ["posts/b/index.json"], "Delete B", editor);
    await assert.rejects(s.workspace.policy.push(tree(s), refused), ApiError);
    rmSync(join(host.bare(s.name), "hooks", "pre-receive"));

    const revision = await commitPaths(tree(s), ["posts/b/index.json"], "Delete B again", editor);
    assert.equal((await s.workspace.policy.push(tree(s), revision)).state, "published");
  });

  it("clears a pending publication when it turns back into drafts", async () => {
    const s = await setup();
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Published"}\n');
    const revision = await commitPaths(tree(s), ["posts/a/index.json"], "Edit A", editor);
    const bare = host.bare(s.name);
    renameSync(bare, `${bare}.away`);
    assert.equal((await s.workspace.policy.push(tree(s), revision)).state, "committed-pending-push");
    renameSync(`${bare}.away`, bare);

    // Upstream moves, and the editor saves the same entry again before the retry.
    upstream(s, (dir) => writeIn(dir, "content/theme.json", '{"color":"green"}\n'));
    writeIn(s.repo, "content/posts/a/index.json", '{"title":"Saved again"}\n');
    const state = await s.workspace.sync();
    assert.equal(state.pendingPush, null);
    assert.match(devGit(s.repo, "status", "--porcelain"), /content\/posts\/a\/index\.json/);
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

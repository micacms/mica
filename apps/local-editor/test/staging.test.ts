/**
 * The runtime's staging service on the developer's checkout, as the local
 * editor composes it. Uses real Git repositories, not a stubbed runner: the
 * properties under test belong to Git.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync as writeFile } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { collection, defineSite, singleton, slug, text } from "@micacms/core/internal";
import {
  ApiError,
  contentFiles,
  createLogger,
  createWorkingTreeStagingService,
  type ContentStagingService,
  type Logger,
} from "@micacms/runtime";

import { developerPolicy } from "../src/developer.js";

const silent = createLogger({ level: "silent", pretty: false });

/** Writes a file, and the entry folder it belongs in. */
function writeFileSync(path: string, data: string, options?: Parameters<typeof writeFile>[2]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFile(path, data, options);
}

/** Entries without rich text: each is a folder with one `index.json`. */
const model = defineSite({
  collections: {
    projects: collection({
      label: "Projects",
      fields: {
        title: text({ label: "Title", required: true }),
        slug: slug({ from: "title" }),
      },
    }),
  },
});

const directories: string[] = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

interface Repo {
  root: string;
  contentRoot: string;
  service: ContentStagingService;
  head(): string;
}

/** A repository with one committed entry under `content/`. */
function makeRepo(
  options: {
    publishEnabled?: boolean;
    schemaRevision?: string | null;
    readOnly?: ReadonlyMap<string, string>;
    logger?: Logger;
  } = {},
): Repo {
  const root = temp("mica-wt-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");

  const contentRoot = join(root, "content");
  mkdirSync(join(contentRoot, "projects"), { recursive: true });
  writeFileSync(
    join(contentRoot, "projects/haus-a/index.json"),
    JSON.stringify({ title: "Haus A", slug: "haus-a" }, null, 2),
  );
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");

  const service = createWorkingTreeStagingService({
    model,
    files: contentFiles({ root: contentRoot }),
    contentRoot,
    schemaRevision: options.schemaRevision ?? null,
    ...(options.readOnly ? { readOnly: options.readOnly } : {}),
    logger: options.logger ?? silent,
    policy: developerPolicy({ publishEnabled: options.publishEnabled ?? true, logger: options.logger ?? silent }),
  });

  return { root, contentRoot, service, head: () => git(root, "rev-parse", "HEAD") };
}

describe("a read-only collection", () => {
  // Mica never publishes what this build cannot interpret, even a change made outside the editor.
  it("turns its pending changes into problems that block Publish", async () => {
    const { contentRoot, service } = makeRepo({ readOnly: new Map([["collections.projects", "Upgrade Mica to edit it."]]) });
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), JSON.stringify({ title: "Haus A, changed", slug: "haus-a" }));

    const status = await service.status();
    assert.equal(status.validation.ok, false);
    assert.deepEqual(
      status.validation.problems.map((problem) => [problem.path, problem.issues[0]?.message]),
      [["projects/haus-a/index.json", "Upgrade Mica to edit it."]],
    );
  });

  it("also blocks a stray file in its directory", async () => {
    const { contentRoot, service } = makeRepo({ readOnly: new Map([["collections.projects", "Upgrade Mica to edit it."]]) });
    writeFileSync(join(contentRoot, "projects/notes.txt"), "not an entry");

    const status = await service.status();
    assert.deepEqual(status.validation.problems.map((problem) => problem.path), ["projects/notes.txt"]);
  });
});

describe("status", () => {
  it("outside a repository, publishing is unavailable and says why", async () => {
    const contentRoot = temp("mica-norepo-");
    const service = createWorkingTreeStagingService({
      model,
      files: contentFiles({ root: contentRoot }),
      contentRoot,
      schemaRevision: null,
      logger: silent,
      policy: developerPolicy({ publishEnabled: true, logger: silent }),
    });

    const status = await service.status();
    assert.equal(status.publish.enabled, false);
    assert.match(status.publish.reason!, /git repository/i);
    assert.deepEqual(status.changes, []);
  });

  it("reads the change list from the tree, with kinds and owners", async () => {
    const { contentRoot, service, head } = makeRepo();

    writeFileSync(
      join(contentRoot, "projects/haus-a/index.json"),
      JSON.stringify({ title: "Haus A, renovated", slug: "haus-a" }),
    );
    writeFileSync(
      join(contentRoot, "projects/haus-b/index.json"),
      JSON.stringify({ title: "Haus B", slug: "haus-b" }),
    );
    // Build output is not the editor's.
    mkdirSync(join(contentRoot, ".mica"), { recursive: true });
    writeFileSync(join(contentRoot, ".mica/schema.json"), "{}");

    const status = await service.status();

    assert.equal(status.owner, "developer");
    assert.equal(status.head, head());
    assert.equal(status.sync, null);
    assert.equal(status.branch, "main");
    assert.equal(status.validation.ok, true);

    const byPath = new Map(status.changes.map((change) => [change.path, change]));
    assert.equal(byPath.get("projects/haus-a/index.json")?.kind, "update");
    assert.equal(byPath.get("projects/haus-b/index.json")?.kind, "create");
    assert.equal(byPath.get("projects/haus-b/index.json")?.owner.label, "Projects: Haus B");
    assert.equal(byPath.has(".mica/schema.json"), false);
  });

  it("a rename the developer staged reads as create plus delete", async () => {
    const { root, service } = makeRepo();
    git(root, "mv", "content/projects/haus-a", "content/projects/haus-z");

    const status = await service.status();
    const byPath = new Map(status.changes.map((change) => [change.path, change.kind]));

    assert.equal(byPath.get("projects/haus-z/index.json"), "create");
    assert.equal(byPath.get("projects/haus-a/index.json"), "delete");
  });

  it("a URL change reads as one renamed entry", async () => {
    const { contentRoot, service } = makeRepo();
    unlinkSync(join(contentRoot, "projects/haus-a/index.json"));
    writeFileSync(
      join(contentRoot, "projects/haus-z/index.json"),
      JSON.stringify({ title: "Haus A", slug: "haus-z" }, null, 2),
    );

    const status = await service.status();
    for (const change of status.changes) {
      assert.deepEqual(change.owner, {
        kind: "entry",
        collection: "projects",
        slug: "haus-z",
        label: "Projects: Haus A",
        renamedFrom: "haus-a",
      });
    }

    const { before, after } = await service.compare({
      kind: "entry",
      collection: "projects",
      slug: "haus-z",
      from: "haus-a",
    });
    assert.deepEqual(before, { title: "Haus A", slug: "haus-a" });
    assert.deepEqual(after, { title: "Haus A", slug: "haus-z" });
  });

  it("an order file changed only by the rename belongs to the renamed entry", async () => {
    const { root, contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-b/index.json"), JSON.stringify({ title: "Haus B", slug: "haus-b" }));
    writeFileSync(join(contentRoot, "projects/_order.json"), JSON.stringify(["haus-b", "haus-a"]));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "order");

    unlinkSync(join(contentRoot, "projects/haus-a/index.json"));
    writeFileSync(
      join(contentRoot, "projects/haus-z/index.json"),
      JSON.stringify({ title: "Haus A", slug: "haus-z" }, null, 2),
    );
    writeFileSync(join(contentRoot, "projects/_order.json"), JSON.stringify(["haus-b", "haus-z"]));

    const status = await service.status();
    const order = status.changes.find((change) => change.path === "projects/_order.json");
    assert.deepEqual(order?.owner, {
      kind: "entry",
      collection: "projects",
      slug: "haus-z",
      label: "Projects: Haus A",
      renamedFrom: "haus-a",
    });
  });

  it("an unrelated deletion and creation stay two entries", async () => {
    const { contentRoot, service } = makeRepo();
    unlinkSync(join(contentRoot, "projects/haus-a/index.json"));
    writeFileSync(
      join(contentRoot, "projects/haus-b/index.json"),
      JSON.stringify({ title: "Haus B", slug: "haus-b" }, null, 2),
    );

    const status = await service.status();
    const bySlug = new Map(status.changes.map((change) => [change.path, change.owner]));
    assert.deepEqual(
      [bySlug.get("projects/haus-a/index.json"), bySlug.get("projects/haus-b/index.json")].map(
        (owner) => owner?.kind === "entry" && [owner.slug, owner.renamedFrom],
      ),
      [
        ["haus-a", undefined],
        ["haus-b", undefined],
      ],
    );
  });

  it("says when each change was saved; a deletion has no time", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-b/index.json"), '{"title":"Haus B","slug":"haus-b"}');
    unlinkSync(join(contentRoot, "projects/haus-a/index.json"));

    const byPath = new Map((await service.status()).changes.map((change) => [change.path, change]));
    assert.ok(Date.parse(byPath.get("projects/haus-b/index.json")?.savedAt ?? "") > Date.now() - 60_000);
    assert.equal(byPath.get("projects/haus-a/index.json")?.savedAt, null);
  });

  it("names an order file that does not parse", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/_order.json"), '["haus-a",]');
    const status = await service.status();
    assert.equal(status.validation.ok, false);
    assert.match(status.validation.problems[0]!.issues[0]!.message, /_order\.json is not valid JSON/);
  });

  it("invalid staged content is named, and blocks nothing else", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(
      join(contentRoot, "projects/haus-b/index.json"),
      JSON.stringify({ title: "", slug: "haus-b" }),
    );

    const status = await service.status();
    assert.equal(status.validation.ok, false);
    assert.equal(status.validation.problems[0]?.path, "projects/haus-b/index.json");
  });
});

/** The paths the Publish page shows, with the revisions it shows them at. */
async function reviewed(service: ContentStagingService): Promise<Record<string, string | null>> {
  const status = await service.status();
  return Object.fromEntries(status.changes.map((change) => [change.path, change.revision ?? null]));
}

describe("publish", () => {
  it("refuses a file that was saved again after the review", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Reviewed","slug":"haus-a"}');
    const paths = await reviewed(service);
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Saved again","slug":"haus-a"}');

    await assert.rejects(
      service.publish({ message: "Publish", paths }),
      (error: unknown) => error instanceof ApiError && error.code === "conflict",
    );
  });

  it("publishes the reviewed entry and leaves another entry's later draft alone", async () => {
    const { root, contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Reviewed","slug":"haus-a"}');
    const paths = await reviewed(service);
    // Another editor's save after the review.
    writeFileSync(join(contentRoot, "projects/haus-c/index.json"), '{"title":"Haus C","slug":"haus-c"}');

    await service.publish({ message: "Publish A", paths });

    assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").split("\n"), ["content/projects/haus-a/index.json"]);
    assert.deepEqual(
      (await service.status()).changes.map((change) => change.path),
      ["projects/haus-c/index.json"],
    );
  });

  it("commits only the reviewed paths, and reports a failed push as a state", async () => {
    const { root, contentRoot, service } = makeRepo();

    writeFileSync(
      join(contentRoot, "projects/haus-a/index.json"),
      JSON.stringify({ title: "Haus A, renovated", slug: "haus-a" }),
    );

    // Unrelated developer work, some of it staged, must stay out of the commit.
    writeFileSync(join(root, "notes.txt"), "developer notes");
    writeFileSync(join(root, "staged.txt"), "already staged");
    git(root, "add", "staged.txt");

    const result = await service.publish({ message: "Renovate Haus A", paths: await reviewed(service) });

    // No remote, so the push fails.
    assert.equal(result.state, "committed-pending-push");
    assert.ok(result.revision);
    assert.ok(result.pushError);

    assert.equal(git(root, "log", "-1", "--format=%s"), "Renovate Haus A");
    const committed = git(root, "show", "--name-only", "--format=", "HEAD").split("\n");
    assert.deepEqual(committed, ["content/projects/haus-a/index.json"]);

    assert.equal(readFileSync(join(root, "notes.txt"), "utf8"), "developer notes");
    assert.match(git(root, "status", "--porcelain"), /^A {2}staged\.txt$/m);

    const status = await service.status();
    assert.deepEqual(status.changes, []);
  });

  it("a published URL change is a rename in Git, so the history follows the file", async () => {
    const { root, contentRoot, service } = makeRepo();
    unlinkSync(join(contentRoot, "projects/haus-a/index.json"));
    writeFileSync(
      join(contentRoot, "projects/haus-z/index.json"),
      JSON.stringify({ title: "Haus A", slug: "haus-z" }, null, 2),
    );

    await service.publish({ message: "Move Haus A", paths: await reviewed(service) });

    assert.match(
      git(root, "show", "-M", "--name-status", "--format=", "HEAD"),
      /^R\d{3}\tcontent\/projects\/haus-a\/index\.json\tcontent\/projects\/haus-z\/index\.json$/,
    );
    assert.equal(git(root, "log", "--follow", "--format=%s", "--", "content/projects/haus-z/index.json"), "Move Haus A\ninit");
  });

  it("push retries the push and never creates a second commit", async () => {
    const { root, contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Once","slug":"haus-a"}');

    const first = await service.publish({ message: "Once", paths: await reviewed(service) });
    assert.equal(first.state, "committed-pending-push");

    // The developer adds the remote.
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "origin", "HEAD~1:refs/heads/main");
    git(root, "fetch", "-q", "origin");
    git(root, "config", "branch.main.remote", "origin");
    git(root, "config", "branch.main.merge", "refs/heads/main");

    const retried = await service.push();
    assert.equal(retried.state, "published");
    assert.equal(retried.revision, first.revision);
    assert.equal(git(bare, "rev-parse", "HEAD"), first.revision);
    assert.equal(git(root, "rev-list", "--count", "HEAD"), "2");
  });

  it("publishes end to end when an upstream exists", async () => {
    const { root, contentRoot, service } = makeRepo();
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "-u", "origin", "main");

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Live","slug":"haus-a"}');

    const result = await service.publish({ message: "Go live", paths: await reviewed(service) });
    assert.equal(result.state, "published");
    assert.equal(git(bare, "rev-parse", "HEAD"), result.revision);
  });

  it("pushes a new branch to origin and sets its upstream", async () => {
    const { root, contentRoot, service } = makeRepo();
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "-u", "origin", "main");
    git(root, "switch", "-q", "-c", "feature/mica");

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"New","slug":"haus-a"}');
    const result = await service.publish({ message: "On a branch", paths: await reviewed(service) });

    assert.equal(result.state, "published");
    assert.equal(git(bare, "rev-parse", "feature/mica"), result.revision);
    assert.equal(git(root, "rev-parse", "--abbrev-ref", "@{upstream}"), "origin/feature/mica");
  });

  it("names the command when a branch has no upstream and there is no origin", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"New","slug":"haus-a"}');
    const result = await service.publish({ message: "No remote", paths: await reviewed(service) });

    assert.equal(result.state, "committed-pending-push");
    assert.match(result.pushError!, /no remote\. Add one with `git remote add origin <url>`/);
  });

  it("names the push command when the remote is not called origin", async () => {
    const { root, contentRoot, service } = makeRepo();
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "upstream", bare);
    git(root, "push", "-q", "upstream", "main");
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"New","slug":"haus-a"}');
    const result = await service.publish({ message: "Other remote", paths: await reviewed(service) });

    assert.equal(result.state, "committed-pending-push");
    assert.match(result.pushError!, /git push -u upstream HEAD/);
  });

  it("names the first push of a new project, whose branch has no upstream", async () => {
    // A project from the starter: commits, and an empty repository on the host.
    const { root, contentRoot, service } = makeRepo();
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"First","slug":"haus-a"}');

    await assert.rejects(
      service.publish({ message: "First", paths: await reviewed(service) }),
      (error: unknown) => error instanceof ApiError && /\(`git push -u origin HEAD`\)/.test(error.message),
    );

    git(root, "push", "-q", "-u", "origin", "HEAD");
    const result = await service.publish({ message: "First", paths: await reviewed(service) });
    assert.equal(result.state, "published");
    assert.equal(git(bare, "rev-parse", "main"), result.revision);
  });

  it("marks its commit with Mica's trailer, under the editor's summary", async () => {
    const { root, contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Marked","slug":"haus-a"}');
    await service.publish({ message: "Update Haus A", paths: await reviewed(service) });

    assert.equal(git(root, "log", "-1", "--format=%s"), "Update Haus A");
    assert.match(git(root, "log", "-1", "--format=%B"), /^Published-with: Mica$/m);
  });

  it("refuses while the branch holds other commits that no remote has, and commits nothing", async () => {
    const { root, contentRoot, service } = makeRepo();
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "-u", "origin", "main");

    writeFileSync(join(root, "astro.config.mjs"), "export default {};");
    git(root, "add", "astro.config.mjs");
    git(root, "commit", "-q", "-m", "Developer work");
    const before = git(root, "rev-parse", "HEAD");

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Blocked","slug":"haus-a"}');
    assert.deepEqual((await service.status()).unpushed, { mica: 0, other: 1 });

    await assert.rejects(
      service.publish({ message: "Blocked", paths: await reviewed(service) }),
      (error: unknown) =>
        error instanceof ApiError && error.code === "conflict" && /1 change that was not made in Mica/.test(error.message),
    );
    assert.equal(git(root, "rev-parse", "HEAD"), before);
    assert.equal(git(bare, "rev-parse", "HEAD"), git(root, "rev-parse", "HEAD~1"));
  });

  it("counts its own unsent commit, and a retry refuses once another commit follows it", async () => {
    const { root, contentRoot, service } = makeRepo();
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "-u", "origin", "main");
    // The push fails until the hook goes.
    const hook = join(bare, "hooks/pre-receive");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Waiting","slug":"haus-a"}');
    const first = await service.publish({ message: "Waiting", paths: await reviewed(service) });
    assert.equal(first.state, "committed-pending-push");
    assert.deepEqual((await service.status()).unpushed, { mica: 1, other: 0 });

    writeFileSync(join(root, "notes.txt"), "later");
    git(root, "add", "notes.txt");
    git(root, "commit", "-q", "-m", "Developer work");
    unlinkSync(hook);

    const retried = await service.push();
    assert.equal(retried.state, "committed-pending-push");
    assert.match(retried.pushError ?? "", /1 change that was not made in Mica/);
    assert.equal(git(bare, "rev-parse", "HEAD"), git(root, "rev-parse", "HEAD~2"));
  });

  it("counts a commit that is on another remote branch but new to the upstream", async () => {
    const { root, contentRoot, service } = makeRepo();
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "-u", "origin", "main");

    // A feature branch is on the remote, and main is fast-forwarded to it.
    git(root, "switch", "-q", "-c", "feature/x");
    writeFileSync(join(root, "feature.txt"), "feature");
    git(root, "add", "feature.txt");
    git(root, "commit", "-q", "-m", "Feature");
    git(root, "push", "-q", "origin", "feature/x");
    git(root, "switch", "-q", "main");
    git(root, "merge", "-q", "--ff-only", "feature/x");

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Blocked","slug":"haus-a"}');
    assert.deepEqual((await service.status()).unpushed, { mica: 0, other: 1 });
    await assert.rejects(
      service.publish({ message: "Blocked", paths: await reviewed(service) }),
      (error: unknown) => error instanceof ApiError && error.code === "conflict",
    );
  });

  it("logs who published and who discarded, without the content", async () => {
    const lines: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const logger: Logger = {
      debug() {},
      info: (message, fields) => lines.push({ message, ...(fields ? { fields } : {}) }),
      warn() {},
      error() {},
      child: () => logger,
    };
    const { contentRoot, service } = makeRepo({ logger });

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Secret words","slug":"haus-a"}');
    await service.publish({ message: "Publish", paths: await reviewed(service), editor: "anna@example.com" });
    writeFileSync(join(contentRoot, "projects/haus-b/index.json"), '{"title":"Draft","slug":"haus-b"}');
    await service.discard({ "projects/haus-b/index.json": (await reviewed(service))["projects/haus-b/index.json"]! }, "ben@example.com");

    const published = lines.find((line) => line.message === "Published");
    assert.equal(published?.fields?.editor, "anna@example.com");
    assert.deepEqual(lines.find((line) => line.message === "Discarded")?.fields, {
      paths: ["projects/haus-b/index.json"],
      editor: "ben@example.com",
    });
    assert.doesNotMatch(JSON.stringify(lines), /Secret words/);
  });

  it("is refused when disabled by configuration", async () => {
    const { contentRoot, service } = makeRepo({ publishEnabled: false });
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"No","slug":"haus-a"}');

    const status = await service.status();
    assert.equal(status.publish.enabled, false);
    assert.equal(status.changes.length, 1, "the read-only view still lists changes");

    await assert.rejects(
      service.publish({ message: "Try", paths: await reviewed(service) }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  });

  it("refuses across model drift, and asks for a new review", async () => {
    const { contentRoot, service } = makeRepo({ schemaRevision: "the-startup-revision" });
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Drift","slug":"haus-a"}');

    await assert.rejects(
      service.publish({ message: "Publish", paths: await reviewed(service) }),
      (error: unknown) =>
        error instanceof ApiError && error.code === "conflict" && /changed just now/.test(error.message),
    );
  });
});

describe("discard", () => {
  it("restores a tracked file and removes an untracked one", async () => {
    const { contentRoot, service } = makeRepo();

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Edited","slug":"haus-a"}');
    writeFileSync(join(contentRoot, "projects/haus-b/index.json"), '{"title":"New","slug":"haus-b"}');

    const { discarded } = await service.discard(await reviewed(service));

    assert.deepEqual(discarded, ["projects/haus-a/index.json", "projects/haus-b/index.json"]);
    assert.equal(
      JSON.parse(readFileSync(join(contentRoot, "projects/haus-a/index.json"), "utf8")).title,
      "Haus A",
    );
    assert.equal(existsSync(join(contentRoot, "projects/haus-b/index.json")), false);
  });

  it("restores a deleted file", async () => {
    const { contentRoot, service } = makeRepo();
    unlinkSync(join(contentRoot, "projects/haus-a/index.json"));

    const { discarded } = await service.discard(await reviewed(service));
    assert.deepEqual(discarded, ["projects/haus-a/index.json"]);
    assert.equal(existsSync(join(contentRoot, "projects/haus-a/index.json")), true);
  });

  // Two editors: the second saves after the first opened the Publish page.
  it("refuses a draft that was saved again after the review, and keeps it", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"First","slug":"haus-a"}');
    const seen = await reviewed(service);
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Second","slug":"haus-a"}');

    await assert.rejects(service.discard(seen), (error: unknown) => error instanceof ApiError && error.code === "conflict");
    assert.match(readFileSync(join(contentRoot, "projects/haus-a/index.json"), "utf8"), /Second/);
  });

  it("refuses part of an entry, and a path that is not pending", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Edited","slug":"haus-a"}');
    writeFileSync(join(contentRoot, "projects/haus-a/notes.mdoc"), "A colleague's new file.\n");
    const seen = await reviewed(service);

    await assert.rejects(service.discard({ "projects/haus-a/index.json": seen["projects/haus-a/index.json"]! }), ApiError);
    await assert.rejects(service.discard({ "projects/haus-z/index.json": null }), ApiError);
    assert.ok(existsSync(join(contentRoot, "projects/haus-a/notes.mdoc")));
  });
});

describe("the comparison's revisions", () => {
  it("are the revisions of the compared document's files, which Publish takes back", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Seen","slug":"haus-a"}');
    writeFileSync(join(contentRoot, "projects/haus-b/index.json"), '{"title":"Other","slug":"haus-b"}');

    const comparison = await service.compare({ kind: "entry", collection: "projects", slug: "haus-a" });
    assert.deepEqual(Object.keys(comparison.revisions), ["projects/haus-a/index.json"]);

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Not seen","slug":"haus-a"}');
    await assert.rejects(service.publish({ message: "Publish", paths: comparison.revisions }), ApiError);
  });
});

describe("before/after comparison", () => {
  it("an edited entry compares HEAD against the working tree", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(
      join(contentRoot, "projects/haus-a/index.json"),
      JSON.stringify({ title: "Haus A, renovated", slug: "haus-a" }, null, 2),
    );

    const { before, after } = await service.compare({
      kind: "entry",
      collection: "projects",
      slug: "haus-a",
    });
    assert.equal(before?.["title"], "Haus A");
    assert.equal(after?.["title"], "Haus A, renovated");
  });

  it("a new entry has no before, a deleted one no after", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(
      join(contentRoot, "projects/haus-b/index.json"),
      JSON.stringify({ title: "Haus B", slug: "haus-b" }, null, 2),
    );
    unlinkSync(join(contentRoot, "projects/haus-a/index.json"));

    const created = await service.compare({ kind: "entry", collection: "projects", slug: "haus-b" });
    assert.equal(created.before, null);
    assert.equal(created.after?.["title"], "Haus B");

    const removed = await service.compare({ kind: "entry", collection: "projects", slug: "haus-a" });
    assert.equal(removed.before?.["title"], "Haus A");
    assert.equal(removed.after, null);
  });

  it("outside a repository, everything reads as new", async () => {
    const contentRoot = join(temp("mica-wt-norepo-"), "content");
    mkdirSync(join(contentRoot, "projects"), { recursive: true });
    writeFileSync(
      join(contentRoot, "projects/haus-a/index.json"),
      JSON.stringify({ title: "Haus A", slug: "haus-a" }, null, 2),
    );

    const service = createWorkingTreeStagingService({
      model,
      files: contentFiles({ root: contentRoot }),
      contentRoot,
      schemaRevision: null,
      logger: silent,
      policy: developerPolicy({ publishEnabled: true, logger: silent }),
    });

    const { before, after } = await service.compare({
      kind: "entry",
      collection: "projects",
      slug: "haus-a",
    });
    assert.equal(before, null);
    assert.equal(after?.["title"], "Haus A");
  });

  it("an unknown collection is refused", async () => {
    const { service } = makeRepo();
    await assert.rejects(
      service.compare({ kind: "entry", collection: "nope", slug: "haus-a" }),
      (error: unknown) => error instanceof ApiError,
    );
  });
});

/** Git refuses a submodule from a local path unless the file protocol is allowed. */
const SUBMODULE = ["-c", "protocol.file.allow=always"];

function identify(dir: string): void {
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
}

/** A website repository with its content repository as the submodule `content/`, whose root is the content root. */
function makeWebsite(): { website: string; contentBare: string } {
  const contentBare = temp("mica-content-bare-");
  git(contentBare, "init", "-q", "--bare", "-b", "main");
  const seed = temp("mica-content-seed-");
  git(seed, "init", "-q", "-b", "main");
  identify(seed);
  writeFileSync(join(seed, "projects/haus-a/index.json"), JSON.stringify({ title: "Haus A", slug: "haus-a" }, null, 2));
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "push", "-q", contentBare, "main");

  const website = temp("mica-website-");
  git(website, "init", "-q", "-b", "main");
  identify(website);
  writeFileSync(join(website, "astro.config.mjs"), "export default {};\n");
  git(website, ...SUBMODULE, "submodule", "add", "-q", contentBare, "content");
  git(website, "add", "-A");
  git(website, "commit", "-q", "-m", "Add the content");
  return { website, contentBare };
}

function serviceFor(contentRoot: string): ContentStagingService {
  return createWorkingTreeStagingService({
    model,
    files: contentFiles({ root: contentRoot }),
    contentRoot,
    schemaRevision: null,
    logger: silent,
    policy: developerPolicy({ publishEnabled: true, logger: silent }),
  });
}

describe("a content root in a Git submodule", () => {
  it("publishes into the content repository and never commits in the website repository", async () => {
    const { website, contentBare } = makeWebsite();
    const contentRoot = join(website, "content");
    identify(contentRoot);
    const service = serviceFor(contentRoot);
    const websiteHead = git(website, "rev-parse", "HEAD");

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Saved","slug":"haus-a"}');
    const status = await service.status();
    assert.equal(status.detached, null);
    assert.equal(status.branch, "main");
    assert.deepEqual(status.changes.map((change) => change.path), ["projects/haus-a/index.json"]);

    const result = await service.publish({ message: "Publish Haus A", paths: await reviewed(service) });
    assert.equal(result.state, "published", result.pushError);
    assert.equal(git(contentBare, "rev-parse", "main"), result.revision);
    assert.equal(git(website, "rev-parse", "HEAD"), websiteHead);
    // The submodule moved on; the website's pointer is the developer's to commit, or CI's to update.
    assert.match(git(website, "status", "--porcelain"), /^ ?M content$/m);
  });

  it("on a detached HEAD, refuses Publish before it commits and names the command", async () => {
    const { website, contentBare } = makeWebsite();
    // A fresh clone of the website, as a colleague or CI gets it: the submodule is on no branch.
    const checkout = temp("mica-website-clone-");
    git(checkout, ...SUBMODULE, "clone", "-q", "--recurse-submodules", website, ".");
    const contentRoot = join(checkout, "content");
    identify(contentRoot);
    const service = serviceFor(contentRoot);
    const head = git(contentRoot, "rev-parse", "HEAD");

    writeFileSync(join(contentRoot, "projects/haus-a/index.json"), '{"title":"Saved","slug":"haus-a"}');
    const status = await service.status();
    assert.ok(status.detached);
    assert.notEqual(status.detached.superproject, null);
    assert.equal(status.branch, null);
    assert.match(status.detached.command, /^git -C .+content'? switch main$/);

    await assert.rejects(
      service.publish({ message: "Publish Haus A", paths: await reviewed(service) }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "conflict" &&
        /submodule.*not on a branch.*switch main/.test(error.message),
    );
    assert.equal(git(contentRoot, "rev-parse", "HEAD"), head);
    assert.deepEqual((await service.status()).changes.map((change) => change.path), ["projects/haus-a/index.json"]);

    // What the command does; the draft goes along.
    git(contentRoot, "switch", "-q", "main");
    const result = await service.publish({ message: "Publish Haus A", paths: await reviewed(service) });
    assert.equal(result.state, "published", result.pushError);
    assert.equal(git(contentBare, "rev-parse", "main"), result.revision);
  });
});

const hasLfs = (() => {
  try {
    execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("publish with Git LFS", { skip: hasLfs ? false : "git-lfs is not installed" }, () => {
  it("sends the LFS objects without the pre-push hook, and commits a pointer", async () => {
    const { root, contentRoot, service } = makeRepo();
    // Set up in the repository, so the test does not depend on this machine's LFS set-up; and no hooks run.
    git(root, "config", "filter.lfs.process", "git-lfs filter-process");
    git(root, "config", "filter.lfs.required", "true");
    git(root, "config", "core.hooksPath", temp("mica-no-hooks-"));
    writeFileSync(join(contentRoot, ".gitattributes"), "*.png filter=lfs diff=lfs merge=lfs -text\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "Use LFS");
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "-u", "origin", "main");

    const image = randomBytes(4096);
    mkdirSync(join(contentRoot, "projects/haus-a/media"), { recursive: true });
    writeFile(join(contentRoot, "projects/haus-a/media/photo.png"), image);
    const result = await service.publish({ message: "A photo", paths: await reviewed(service) });

    assert.equal(result.state, "published", result.pushError);
    assert.match(git(bare, "show", "HEAD:content/projects/haus-a/media/photo.png"), /^version https:\/\/git-lfs/);
    const oid = createHash("sha256").update(image).digest("hex");
    assert.deepEqual(readFileSync(join(bare, "lfs", "objects", oid.slice(0, 2), oid.slice(2, 4), oid)), image);
  });
});

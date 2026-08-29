/**
 * Working-tree staging, against real Git.
 *
 * Real repositories in temporary directories rather than a stubbed runner,
 * because the properties under test belong to Git: what status says about a
 * rename, what a pathspec-limited commit leaves alone, what push does with
 * and without an upstream. A stub would only prove the service agrees with
 * itself.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { localConnector } from "@micacms/connectors";
import { collection, defineSite, slug, text } from "@micacms/model";

import { ApiError } from "../src/server/lib/errors.js";
import { createLogger } from "../src/server/lib/logger.js";
import { createWorkingTreeStagingService } from "../src/server/services/staging-local.js";
import type { ContentStagingService } from "../src/server/services/staging.js";

/** File-layout entries, so a path is one JSON file and assertions stay short. */
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
function makeRepo(options: { publishEnabled?: boolean; schemaRevision?: string | null } = {}): Repo {
  const root = temp("mica-wt-");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");

  const contentRoot = join(root, "content");
  mkdirSync(join(contentRoot, "projects"), { recursive: true });
  writeFileSync(
    join(contentRoot, "projects/haus-a.json"),
    JSON.stringify({ title: "Haus A", slug: "haus-a" }, null, 2),
  );
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");

  const service = createWorkingTreeStagingService({
    model,
    connector: localConnector({ root: contentRoot }),
    contentRoot,
    schemaRevision: options.schemaRevision ?? null,
    publishEnabled: options.publishEnabled ?? true,
    logger: createLogger({ level: "silent", pretty: false }),
  });

  return { root, contentRoot, service, head: () => git(root, "rev-parse", "HEAD") };
}

/* ------------------------------------------------------------------ */

describe("status", () => {
  it("outside a repository, publishing is unavailable and says why", async () => {
    const contentRoot = temp("mica-norepo-");
    const service = createWorkingTreeStagingService({
      model,
      connector: localConnector({ root: contentRoot }),
      contentRoot,
      schemaRevision: null,
      publishEnabled: true,
      logger: createLogger({ level: "silent", pretty: false }),
    });

    const status = await service.status();
    assert.equal(status.publish.enabled, false);
    assert.match(status.publish.reason!, /git repository/i);
    assert.deepEqual(status.changes, []);
  });

  it("reads the change list from the tree, with kinds and owners", async () => {
    const { contentRoot, service, head } = makeRepo();

    writeFileSync(
      join(contentRoot, "projects/haus-a.json"),
      JSON.stringify({ title: "Haus A, renovated", slug: "haus-a" }),
    );
    writeFileSync(
      join(contentRoot, "projects/haus-b.json"),
      JSON.stringify({ title: "Haus B", slug: "haus-b" }),
    );
    // Build output is the developer's business, never the editor's.
    mkdirSync(join(contentRoot, ".mica"), { recursive: true });
    writeFileSync(join(contentRoot, ".mica/schema.json"), "{}");

    const status = await service.status();

    assert.equal(status.workspace, "working-tree");
    assert.equal(status.baseRevision, head());
    assert.equal(status.branch, "main");
    assert.equal(status.validation.ok, true);

    const byPath = new Map(status.changes.map((change) => [change.path, change]));
    assert.equal(byPath.get("projects/haus-a.json")?.kind, "update");
    assert.equal(byPath.get("projects/haus-b.json")?.kind, "create");
    assert.equal(byPath.get("projects/haus-b.json")?.owner.label, "Projects: Haus B");
    assert.equal(byPath.has(".mica/schema.json"), false);
  });

  it("a rename the developer staged reads as create plus delete", async () => {
    const { root, service } = makeRepo();
    git(root, "mv", "content/projects/haus-a.json", "content/projects/haus-z.json");

    const status = await service.status();
    const byPath = new Map(status.changes.map((change) => [change.path, change.kind]));

    assert.equal(byPath.get("projects/haus-z.json"), "create");
    assert.equal(byPath.get("projects/haus-a.json"), "delete");
  });

  it("invalid staged content is named, and blocks nothing else", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(
      join(contentRoot, "projects/haus-b.json"),
      JSON.stringify({ title: "", slug: "haus-b" }),
    );

    const status = await service.status();
    assert.equal(status.validation.ok, false);
    assert.equal(status.validation.problems[0]?.path, "projects/haus-b.json");
  });
});

describe("publish", () => {
  it("refuses without the base the editor reviewed", async () => {
    const { contentRoot, service } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a.json"), '{"title":"Moved","slug":"haus-a"}');

    await assert.rejects(
      service.publish({ message: "Publish", expectedBase: "somewhere-else" }),
      (error: unknown) => error instanceof ApiError && error.code === "conflict",
    );
  });

  it("commits only the reviewed paths, and reports a failed push as a state", async () => {
    const { root, contentRoot, service, head } = makeRepo();
    const base = head();

    writeFileSync(
      join(contentRoot, "projects/haus-a.json"),
      JSON.stringify({ title: "Haus A, renovated", slug: "haus-a" }),
    );

    // A developer's unrelated work, some of it already staged. None of it may
    // end up in the editor's commit.
    writeFileSync(join(root, "notes.txt"), "developer notes");
    writeFileSync(join(root, "staged.txt"), "already staged");
    git(root, "add", "staged.txt");

    const result = await service.publish({ message: "Renovate Haus A", expectedBase: base });

    // No remote: the commit is real, the push failed, and the state says so.
    assert.equal(result.state, "committed-pending-push");
    assert.ok(result.revision);
    assert.ok(result.pushError);

    assert.equal(git(root, "log", "-1", "--format=%s"), "Renovate Haus A");
    const committed = git(root, "show", "--name-only", "--format=", "HEAD").split("\n");
    assert.deepEqual(committed, ["content/projects/haus-a.json"]);

    // The developer's files: untouched, and still staged where they were.
    assert.equal(readFileSync(join(root, "notes.txt"), "utf8"), "developer notes");
    assert.match(git(root, "status", "--porcelain"), /^A {2}staged\.txt$/m);

    // The content change list is clean — published, even if not yet pushed.
    const status = await service.status();
    assert.deepEqual(status.changes, []);
  });

  it("push retries the push and never creates a second commit", async () => {
    const { root, contentRoot, service, head } = makeRepo();
    writeFileSync(join(contentRoot, "projects/haus-a.json"), '{"title":"Once","slug":"haus-a"}');

    const first = await service.publish({ message: "Once", expectedBase: head() });
    assert.equal(first.state, "committed-pending-push");

    // The remote appears — the developer fixes their origin — and the retry
    // must push the existing commit rather than commit again.
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "config", "branch.main.remote", "origin");
    git(root, "config", "branch.main.merge", "refs/heads/main");

    const retried = await service.push();
    assert.equal(retried.state, "published");
    assert.equal(retried.revision, first.revision);
    assert.equal(git(bare, "rev-parse", "HEAD"), first.revision);
    assert.equal(git(root, "rev-list", "--count", "HEAD"), "2");
  });

  it("publishes end to end when an upstream exists", async () => {
    const { root, contentRoot, service, head } = makeRepo();
    const bare = temp("mica-bare-");
    git(bare, "init", "-q", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "-u", "origin", "main");

    writeFileSync(join(contentRoot, "projects/haus-a.json"), '{"title":"Live","slug":"haus-a"}');

    const result = await service.publish({ message: "Go live", expectedBase: head() });
    assert.equal(result.state, "published");
    assert.equal(git(bare, "rev-parse", "HEAD"), result.revision);
  });

  it("is refused when disabled by configuration", async () => {
    const { contentRoot, service, head } = makeRepo({ publishEnabled: false });
    writeFileSync(join(contentRoot, "projects/haus-a.json"), '{"title":"No","slug":"haus-a"}');

    const status = await service.status();
    assert.equal(status.publish.enabled, false);
    assert.equal(status.changes.length, 1, "the read-only view still lists changes");

    await assert.rejects(
      service.publish({ message: "Try", expectedBase: head() }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  });

  it("refuses across model drift, naming the restart", async () => {
    const { contentRoot, service, head } = makeRepo({ schemaRevision: "the-startup-revision" });
    writeFileSync(join(contentRoot, "projects/haus-a.json"), '{"title":"Drift","slug":"haus-a"}');

    await assert.rejects(
      service.publish({ message: "Publish", expectedBase: head() }),
      (error: unknown) =>
        error instanceof ApiError && error.code === "conflict" && /restart/i.test(error.message),
    );
  });
});

describe("discard", () => {
  it("restores a tracked file and removes an untracked one", async () => {
    const { contentRoot, service } = makeRepo();

    writeFileSync(join(contentRoot, "projects/haus-a.json"), '{"title":"Edited","slug":"haus-a"}');
    writeFileSync(join(contentRoot, "projects/haus-b.json"), '{"title":"New","slug":"haus-b"}');

    const { discarded } = await service.discard([
      "projects/haus-a.json",
      "projects/haus-b.json",
      "projects/not-in-the-change-list.json",
    ]);

    assert.deepEqual(discarded, ["projects/haus-a.json", "projects/haus-b.json"]);
    assert.equal(
      JSON.parse(readFileSync(join(contentRoot, "projects/haus-a.json"), "utf8")).title,
      "Haus A",
    );
    assert.equal(existsSync(join(contentRoot, "projects/haus-b.json")), false);
  });

  it("restores a deleted file", async () => {
    const { contentRoot, service } = makeRepo();
    unlinkSync(join(contentRoot, "projects/haus-a.json"));

    const { discarded } = await service.discard(["projects/haus-a.json"]);
    assert.deepEqual(discarded, ["projects/haus-a.json"]);
    assert.equal(existsSync(join(contentRoot, "projects/haus-a.json")), true);
  });
});

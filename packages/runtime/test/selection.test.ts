/** The check of a publication, which Publish and the retry of a refused publication share. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { collection, defineSite, slug, text } from "@micacms/core/internal";

import { contentFiles, groupOf, listTreeChanges, locateTree, validateSelection, type GitTree } from "../src/index.js";

const model = defineSite({
  collections: {
    projects: collection({ label: "Projects", fields: { title: text({ label: "Title", required: true }), slug: slug({ from: "title" }) } }),
  },
});

const root = mkdtempSync(join(tmpdir(), "mica-selection-"));
after(() => rmSync(root, { recursive: true, force: true }));

const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const write = (path: string, data: unknown) => {
  mkdirSync(dirname(join(root, "content", path)), { recursive: true });
  writeFileSync(join(root, "content", path), JSON.stringify(data));
};

git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test");
write("projects/haus-a/index.json", { title: "Haus A", slug: "haus-a" });
git("add", "-A");
git("commit", "-q", "-m", "init");
// A draft that Publish refuses, and one that it takes.
write("projects/haus-b/index.json", { slug: "haus-b" });
write("projects/haus-c/index.json", { title: "Haus C", slug: "haus-c" });

const contentRoot = join(root, "content");
const files = contentFiles({ root: contentRoot });

async function check(paths: string[], readOnly?: ReadonlyMap<string, string>) {
  const tree = (await locateTree(contentRoot)) as GitTree;
  return validateSelection({ model, files, tree, listed: await listTreeChanges(tree), paths, readOnly });
}

describe("validateSelection", () => {
  it("checks only the selected drafts: another broken draft does not block", async () => {
    assert.equal((await check(["projects/haus-c/index.json"])).ok, true);
    const refused = await check(["projects/haus-b/index.json"]);
    assert.deepEqual(refused.problems.map((problem) => problem.path), ["projects/haus-b/index.json"]);
  });

  it("refuses a part that this build cannot write", async () => {
    const refused = await check(["projects/haus-c/index.json"], new Map([["collections.projects", "Upgrade Mica to edit it."]]));
    assert.deepEqual(refused.problems.map((problem) => problem.issues[0]?.message), ["Upgrade Mica to edit it."]);
  });
});

describe("groupOf", () => {
  it("keeps an entry's files together, and gives every other file its own key", () => {
    assert.equal(groupOf({ kind: "entry", collection: "projects", slug: "a", label: "a" }, "projects/a/media/x.png"), "entry:projects/a");
    assert.equal(groupOf({ kind: "singleton", name: "site", label: "Site" }, "site/index.json"), "singleton:site");
    assert.equal(groupOf({ kind: "order", collection: "projects", label: "Projects: order" }, "projects/_order.json"), "order:projects");
    assert.equal(groupOf({ kind: "media", label: "Shared media" }, "media/a.png"), "file:media/a.png");
  });
});

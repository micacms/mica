/** The start's check that a content root in Git LFS can work on this machine. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { lfsSetupProblem } from "../src/lfs.js";

// This machine's own Git configuration must not decide the result.
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = "/dev/null";

const hasLfs = (() => {
  try {
    execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** A repository with a content root, and `.gitattributes` files at the given places. */
function repository(attributes: Record<string, string>): { root: string; contentRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "mica-lfs-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  const contentRoot = join(root, "content");
  mkdirSync(join(contentRoot, ".mica"), { recursive: true });
  writeFileSync(join(contentRoot, ".mica", "schema.json"), "{}\n");
  for (const [path, text] of Object.entries(attributes)) writeFileSync(join(root, path), text);
  return { root, contentRoot };
}

describe("the Git LFS check at start", () => {
  it("passes a content root that does not use LFS", async () => {
    const { contentRoot } = repository({ ".gitattributes": "/public/*.jpg filter=lfs\n" });
    assert.equal(await lfsSetupProblem(contentRoot), null);
  });

  it("passes a content directory outside Git", async () => {
    assert.equal(await lfsSetupProblem(mkdtempSync(join(tmpdir(), "mica-no-git-"))), null);
  });

  it("stops when the content root uses LFS and Git LFS is not set up, and says how to fix it", async () => {
    const { contentRoot } = repository({ "content/.gitattributes": "*.jpg filter=lfs diff=lfs merge=lfs -text\n" });
    const problem = await lfsSetupProblem(contentRoot);
    assert.match(problem ?? "", /^content\/\.gitattributes stores files under the content root with Git LFS/);
    assert.match(problem ?? "", hasLfs ? /not set up in Git\.\n {2}Run `git lfs install` once/ : /not installed/);
  });

  it("passes when Git LFS is installed and set up", { skip: hasLfs ? false : "git-lfs is not installed" }, async () => {
    const { root, contentRoot } = repository({ ".gitattributes": "*.jpg filter=lfs diff=lfs merge=lfs -text\n" });
    execFileSync("git", ["config", "filter.lfs.process", "git-lfs filter-process"], { cwd: root });
    assert.equal(await lfsSetupProblem(contentRoot), null);
  });
});

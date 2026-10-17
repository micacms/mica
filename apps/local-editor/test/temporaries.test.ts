/** The local editor removes the temporary files of an earlier process at start, and keeps those of one that runs. */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { removeStaleTemporaries } from "../src/temporaries.js";

const root = mkdtempSync(join(tmpdir(), "mica-temporaries-"));
after(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, contents = "x"): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
}

describe("removeStaleTemporaries", () => {
  it("removes the files and folders of a process that has ended, and nothing else", async () => {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    // A process that has ended: its id is free.
    const ended = spawnSync(process.execPath, ["-e", ""]).pid;
    write(`content/media/upload.mica-${ended}-0`);
    write(`content/news/hello.mica-${ended}-1/index.json`);
    write(`content/news/hello/index.json.mica-${process.pid}-2`);
    write("content/news/hello/index.json", "{}");

    const removed = await removeStaleTemporaries(join(root, "content"));
    assert.deepEqual(removed.sort(), [`media/upload.mica-${ended}-0`, `news/hello.mica-${ended}-1`]);
    assert.equal(existsSync(join(root, `content/news/hello.mica-${ended}-1`)), false);
    assert.equal(existsSync(join(root, `content/news/hello/index.json.mica-${process.pid}-2`)), true);
    assert.equal(existsSync(join(root, "content/news/hello/index.json")), true);
  });

  it("does nothing outside Git", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mica-no-git-"));
    try {
      writeFileSync(join(outside, "a.mica-1-0"), "x");
      assert.deepEqual(await removeStaleTemporaries(outside), []);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

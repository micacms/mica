/** The site's own copy of the clone: changed files only, without Git and the content, and with what the install made kept. */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { mirror } from "../src/mirror.js";

const folders: string[] = [];
after(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

function folder(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "mica-preview-mirror-"));
  folders.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("the copy of the website", () => {
  it("copies the files, without Git and the content root, and keeps what the install made", () => {
    const clone = folder({ "src/pages/index.astro": "page", ".git/HEAD": "ref", "content/a.json": "{}", "package.json": "{}" });
    const copy = folder({ "node_modules/astro/package.json": "{}", "styled-system/css.mjs": "generated" });
    const { copied, removed, files } = mirror(clone, copy, new Set(["content"]));
    assert.deepEqual({ copied, removed }, { copied: 2, removed: 0 });
    assert.deepEqual([...files].sort(), ["package.json", "src/pages/index.astro"]);
    assert.equal(readFileSync(join(copy, "src/pages/index.astro"), "utf8"), "page");
    assert.equal(existsSync(join(copy, ".git")), false);
    assert.equal(existsSync(join(copy, "content")), false);
    assert.equal(existsSync(join(copy, "node_modules/astro/package.json")), true);
    assert.equal(existsSync(join(copy, "styled-system/css.mjs")), true);
  });

  it("copies again only what changed, and removes what it copied and the clone no longer has", () => {
    const clone = folder({ "src/a.astro": "a", "src/b.astro": "b" });
    const copy = folder();
    const first = mirror(clone, copy, new Set());
    const second = mirror(clone, copy, new Set(), first.files);
    assert.deepEqual([second.copied, second.removed], [0, 0]);
    writeFileSync(join(clone, "src/a.astro"), "a, longer");
    rmSync(join(clone, "src/b.astro"));
    const third = mirror(clone, copy, new Set(), second.files);
    assert.deepEqual([third.copied, third.removed], [1, 1]);
    assert.equal(readFileSync(join(copy, "src/a.astro"), "utf8"), "a, longer");
    assert.equal(existsSync(join(copy, "src/b.astro")), false);
  });

  it("follows a file that becomes a folder, and a folder that becomes a file", () => {
    const clone = folder({ "src/layout": "a file", "src/parts/one.astro": "one" });
    const copy = folder();
    const first = mirror(clone, copy, new Set());
    rmSync(join(clone, "src/layout"));
    rmSync(join(clone, "src/parts"), { recursive: true });
    mkdirSync(join(clone, "src/layout"));
    writeFileSync(join(clone, "src/layout/base.astro"), "base");
    writeFileSync(join(clone, "src/parts"), "now a file");
    mirror(clone, copy, new Set(), first.files);
    assert.equal(readFileSync(join(copy, "src/layout/base.astro"), "utf8"), "base");
    assert.equal(readFileSync(join(copy, "src/parts"), "utf8"), "now a file");
  });
});

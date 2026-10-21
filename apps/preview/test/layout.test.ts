/** Where the preview finds the website in Mica's clone, and how it installs it. */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { contentRootIn, headOf, installCommand, installKey, lockFileOf, siteIn } from "../src/layout.js";

const folders: string[] = [];
after(() => folders.forEach((folder) => rmSync(folder, { recursive: true, force: true })));

/** A repository with these files, each with its text. */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mica-preview-layout-"));
  folders.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe("the website in the clone", () => {
  it("finds the content root and the site above it, also in a workspace", () => {
    const repo = repository({
      "sites/www/astro.config.mjs": "",
      "sites/www/content/.mica/schema.json": "{}",
      "node_modules/other/content/.mica/schema.json": "{}",
      "deep/a/b/c/d/e/f/.gitkeep": "",
      "pnpm-lock.yaml": "",
      "sites/www/package.json": "{}",
    });
    assert.equal(contentRootIn(repo), "sites/www/content");
    assert.equal(siteIn(repo, "sites/www/content"), "sites/www");
    assert.deepEqual(lockFileOf(repo, "sites/www"), { manager: "pnpm", folder: "", file: "pnpm-lock.yaml", berry: false });
  });

  it("takes the folders that the variables name, and waits while there is no content root", () => {
    const repo = repository({ "astro.config.ts": "", "a/.mica/schema.json": "{}", "b/.mica/schema.json": "{}", "package-lock.json": "{}" });
    assert.throws(() => contentRootIn(repo), /more than one content root: .*Set MICA_CONTENT_PATH/);
    assert.equal(contentRootIn(repo, "b/"), "b");
    assert.equal(contentRootIn(repo, "/b"), "b");
    assert.equal(contentRootIn(repo, "c"), null);
    assert.equal(contentRootIn(join(repo, "not-cloned-yet")), null);
    assert.equal(siteIn(repo, "b"), "");
    assert.throws(() => siteIn(repo, "b", "b"), /MICA_PREVIEW_SITE_PATH is b, but that folder has no astro.config/);
  });

  it("refuses Bun, and installs a site without a lock file with npm", () => {
    assert.throws(() => lockFileOf(repository({ "bun.lock": "" }), ""), /installs with Bun/);
    assert.deepEqual(lockFileOf(repository({ "package.json": "{}" }), ""), { manager: "npm", folder: "", file: null, berry: false });
  });
});

describe("the install", () => {
  it("installs as the lock file asks, with the caches in the cache folder", () => {
    const npm = installCommand({ manager: "npm", folder: "", file: "package-lock.json", berry: false }, "/cache");
    assert.deepEqual([npm.command, ...npm.args], ["npm", "ci", "--include=dev", "--no-audit", "--no-fund"]);
    assert.equal(npm.env["npm_config_cache"], "/cache/npm");
    const pnpm = installCommand({ manager: "pnpm", folder: "", file: "pnpm-lock.yaml", berry: false }, "/cache");
    assert.deepEqual([pnpm.command, ...pnpm.args], ["corepack", "pnpm", "install", "--frozen-lockfile", "--store-dir", "/cache/pnpm"]);
    const berry = installCommand({ manager: "yarn", folder: "", file: "yarn.lock", berry: true }, "/cache");
    assert.deepEqual(berry.args, ["yarn", "install", "--immutable"]);
    const classic = installCommand({ manager: "yarn", folder: "", file: "yarn.lock", berry: false }, "/cache");
    assert.deepEqual(classic.args, ["yarn", "install", "--frozen-lockfile", "--cache-folder", "/cache/yarn"]);
  });

  it("installs again only when the lock file or its manifest changes", () => {
    const repo = repository({ "package-lock.json": "{}", "package.json": "{}" });
    const lock = lockFileOf(repo, "");
    const before = installKey(repo, lock);
    writeFileSync(join(repo, "src.astro"), "a template");
    assert.equal(installKey(repo, lock), before);
    writeFileSync(join(repo, "package.json"), '{ "dependencies": {} }');
    assert.notEqual(installKey(repo, lock), before);
  });
});

describe("the clone's commit", () => {
  it("reads a branch, a packed branch and a detached checkout", () => {
    assert.equal(headOf(repository({ ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": "abc123\n" })), "abc123");
    assert.equal(headOf(repository({ ".git/HEAD": "ref: refs/heads/main\n", ".git/packed-refs": "# pack-refs\ndef456 refs/heads/main\n" })), "def456");
    assert.equal(headOf(repository({ ".git/HEAD": "fedcba\n" })), "fedcba");
    assert.equal(headOf(repository({})), null);
  });
});

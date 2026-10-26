/** The commands with the content root in a Git submodule of the website repository: to them, it is a directory. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, createManifest, defineSite, MANIFEST_PATH, id, text } from "@micacms/core/internal";

import { checkContent } from "../src/check.js";
import { contentRoot } from "../src/cli.js";
import { importCollections } from "../src/import.js";
import { initProject } from "../src/init.js";

const site = defineSite({
  collections: {
    team: collection({ label: "Team", fields: { name: text(), id: id({ from: "name" }) } }),
    news: collection({ label: "News", fields: { title: text(), id: id({ from: "title" }) } }),
  },
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function write(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

/** Astro's data store with one collection, in the `devalue` format: only maps, objects and strings. */
function store(file: string, collection: string, entries: Record<string, Record<string, string>>): void {
  const out: unknown[] = [];
  const add = (value: unknown): number => {
    const index = out.push(null) - 1;
    if (value instanceof Map) out[index] = ["Map", ...[...value].flatMap(([key, item]) => [add(key), add(item)])];
    else if (typeof value === "object" && value !== null) {
      out[index] = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, add(item)]));
    } else out[index] = value;
    return index;
  };
  const rows = new Map(Object.entries(entries).map(([id, data]) => [id, { id, data }]));
  add(new Map<string, unknown>([["meta::meta", new Map([["astro-version", "7.2.9"]])], [collection, rows]]));
  write(file, JSON.stringify(out));
}

let website = "";
let content = "";
const temporary: string[] = [];

before(() => {
  const make = (prefix: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), prefix));
    temporary.push(dir);
    return dir;
  };
  const bare = make("mica-content-bare-");
  git(bare, "init", "-q", "--bare", "-b", "main");
  const seed = make("mica-content-seed-");
  git(seed, "init", "-q", "-b", "main");
  write(path.join(seed, MANIFEST_PATH), JSON.stringify(createManifest(site, "test")));
  write(path.join(seed, "team/anna/index.json"), JSON.stringify({ name: "Anna", id: "anna" }));
  git(seed, "add", "-A");
  git(seed, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init");
  git(seed, "push", "-q", bare, "main");

  website = make("mica-website-");
  git(website, "init", "-q", "-b", "main");
  write(path.join(website, "package.json"), JSON.stringify({ dependencies: { astro: "^7.0.0" } }));
  git(website, "-c", "protocol.file.allow=always", "submodule", "add", "-q", bare, "content");
  content = path.join(website, "content");
});

after(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

describe("a content root in a Git submodule", () => {
  it("is found by its model, as any directory is", () => {
    assert.equal(contentRoot({}, {}, website), content);
  });

  it("is checked by mica check", async () => {
    const report = await checkContent(content);
    assert.ok(report.model);
    assert.deepEqual(report.problems.filter((problem) => problem.level === "error"), []);
  });

  it("takes the entries of mica import into the content repository", async () => {
    const from = path.join(website, "node_modules/.astro/data-store.json");
    store(from, "news", { hello: { title: "Hello" } });
    const result = await importCollections({ root: content, project: website, store: from, only: ["news"] });
    assert.deepEqual(result.imported.map((item) => `${item.name}:${item.entries}`), ["news:1"]);
    assert.ok(existsSync(path.join(content, "news/hello/index.json")));
    // Git sees the new files in the content repository, where Publish commits them.
    assert.match(git(content, "status", "--porcelain", "-uall"), /news\/hello\/index\.json/);
  });

  it("is left alone by mica init, which writes only the website's files", () => {
    const result = initProject(website);
    assert.ok(result.created.includes("src/mica.ts"));
    assert.deepEqual(git(content, "status", "--porcelain", "--", MANIFEST_PATH), "");
  });
});

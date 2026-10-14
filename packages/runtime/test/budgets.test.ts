/**
 * Read budgets at the stated scale (#72): 300 entries in 3 collections, in the
 * folder layout with rich text and media, and 1,000 images. A counting file
 * layer and a counting Git runner record what each view reads; the budgets say
 * what a view may touch, and a generous time limit catches a slow path.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, media, relation, richText, slug, text, type Site } from "@micacms/core";

import { createApp } from "../src/app.js";
import { createRuntimeContext, type RuntimeContext } from "../src/context.js";
import { contentFiles, gitRunner, type ContentFiles, type GitRunner } from "../src/index.js";
import { createLogger } from "../src/lib/logger.js";
import { pngBytes, TEST_ORIGIN, testConfig } from "./helpers.js";

const ENTRIES_PER_COLLECTION = 100;
const SHARED_IMAGES = 700;

const fields = {
  title: text({ required: true }),
  slug: slug({ from: "title" }),
  body: richText(),
  cover: media({ accept: "image" }),
};
const site: Site = defineSite({
  collections: {
    projects: collection({ label: "Projects", fields: { ...fields, lead: relation({ collection: "team" }) } }),
    news: collection({ label: "News", fields }),
    team: collection({ label: "Team", fields }),
  },
});

/** Every call by kind, with its path. */
interface Log {
  read: string[];
  readBinary: string[];
  list: string[];
  stat: string[];
  revision: string[];
  git: string[];
}

function counting(files: ContentFiles, log: Log): ContentFiles {
  return {
    origin: files.origin,
    read: (path) => (log.read.push(path), files.read(path)),
    readBinary: (path) => (log.readBinary.push(path), files.readBinary(path)),
    list: (path) => (log.list.push(path), files.list(path)),
    stat: (path) => (log.stat.push(path), files.stat(path)),
    revision: (path) => (log.revision.push(path), files.revision(path)),
    apply: (input) => files.apply(input),
  };
}

function countingGit(git: GitRunner, log: Log): GitRunner {
  return {
    run: (args, call) => (log.git.push(args.join(" ")), git.run(args, call)),
    tryRun: (args, call) => (log.git.push(args.join(" ")), git.tryRun(args, call)),
  };
}

const log: Log = { read: [], readBinary: [], list: [], stat: [], revision: [], git: [] };
const reset = () => {
  for (const key of Object.keys(log) as Array<keyof Log>) log[key] = [];
};

let root = "";
let ctx: RuntimeContext;
let request: (path: string) => Promise<Response>;

/** Runs a view, and returns what it read and how long it took. */
async function measure(view: () => Promise<unknown>): Promise<{ ms: number }> {
  reset();
  const start = performance.now();
  await view();
  return { ms: performance.now() - start };
}

before(() => {
  root = mkdtempSync(join(tmpdir(), "mica-budget-"));
  const content = join(root, "content");
  const write = (path: string, data: string | Uint8Array) => {
    mkdirSync(join(content, path, ".."), { recursive: true });
    writeFileSync(join(content, path), data);
  };
  const png = pngBytes();

  for (const name of Object.keys(site.collections)) {
    for (let index = 0; index < ENTRIES_PER_COLLECTION; index++) {
      const slugValue = `${name}-${index}`;
      write(`${name}/${slugValue}/index.json`, JSON.stringify({ title: `${name} ${index}`, slug: slugValue, cover: "media/cover.png" }));
      write(`${name}/${slugValue}/body.mdoc`, `Text of ${name} ${index}.\n`);
      write(`${name}/${slugValue}/media/cover.png`, png);
    }
  }
  for (let index = 0; index < SHARED_IMAGES; index++) write(`media/image-${index}.png`, png);

  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");

  const files = counting(contentFiles({ root: content }), log);
  ctx = createRuntimeContext({
    config: testConfig(content),
    model: site,
    files,
    logger: createLogger({ level: "silent", pretty: false }),
    tree: { git: countingGit(gitRunner(root), log), prefix: "content", contentRoot: content },
  });
  const app = createApp(ctx);
  request = async (path) => app.request(`${TEST_ORIGIN}${path}`);
});

after(async () => {
  await ctx?.shutdown();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("read budgets at 300 entries and 1,000 images", () => {
  it("opening an entry reads only that entry", async () => {
    const { ms } = await measure(async () => assert.equal((await request("/api/admin/collections/news/entries/news-42")).status, 200));
    // No listing of the collection: the reads stay inside the entry.
    assert.deepEqual(log.list.filter((path) => path === "news"), []);
    const touched = [...log.read, ...log.readBinary, ...log.list];
    assert.ok(touched.every((path) => path.startsWith("news/news-42") || path === ".mica/schema.json"), touched.join(", "));
    assert.equal(log.readBinary.length, 0);
    assert.ok(ms < 1_500, `${ms} ms`);
  });

  it("the free-URL check asks for the candidate's data file only", async () => {
    const { ms } = await measure(() => ctx.services.content.suggestSlug("news", "A new article"));
    assert.deepEqual(log.list, []);
    assert.deepEqual(log.read, []);
    assert.ok(log.stat.length <= 2, log.stat.join(", "));
    assert.ok(ms < 1_000, `${ms} ms`);
  });

  it("the media list reads no file", async () => {
    const { ms } = await measure(async () => {
      const response = await request("/api/admin/media");
      assert.equal(((await response.json()) as { items: unknown[] }).items.length, 1_000);
    });
    assert.equal(log.readBinary.length, 0);
    assert.equal(log.read.length, 0);
    assert.ok(ms < 5_000, `${ms} ms`);
  });

  it("the dashboard and the System page read no file bytes and no entries", async () => {
    for (const path of ["/api/admin/overview", "/api/admin/system"]) {
      const { ms } = await measure(async () => assert.equal((await request(path)).status, 200));
      assert.equal(log.readBinary.length, 0, path);
      assert.deepEqual(log.read.filter((file) => file !== ".mica/schema.json"), [], path);
      assert.ok(ms < 5_000, `${path}: ${ms} ms`);
    }
  });

  it("the change list reads only the changed entries", async () => {
    writeFileSync(join(root, "content/news/news-7/index.json"), JSON.stringify({ title: "Changed", slug: "news-7" }));
    writeFileSync(join(root, "content/team/team-3/body.mdoc"), "Changed text.\n");
    try {
      const { ms } = await measure(async () => assert.equal((await request("/api/admin/changes")).status, 200));
      const entryReads = log.read.filter((path) => /^(news|team|projects)\/[^/]+\//.test(path));
      assert.ok(
        entryReads.every((path) => path.startsWith("news/news-7/") || path.startsWith("team/team-3/")),
        entryReads.join(", "),
      );
      assert.equal(log.readBinary.length, 0);
      assert.ok(log.git.length <= 12, log.git.join("\n"));
      assert.ok(ms < 5_000, `${ms} ms`);
    } finally {
      execFileSync("git", ["checkout", "-q", "--", "content"], { cwd: root });
    }
  });
});

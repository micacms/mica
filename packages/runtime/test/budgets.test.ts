/**
 * Budgets at the 1.0 scale target (#72, #236): 1,000 entries in one collection,
 * 1,300 entries and 5,000 files in all, and 5 editors at the same time. A
 * counting file layer and a counting Git runner record what each operation
 * reads; the budgets say what it may touch, and a generous time limit catches a
 * slow path.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, media, relation, richText, slug, text, type Site } from "@micacms/core/internal";

import { createApp } from "../src/app.js";
import { createRuntimeContext, type RuntimeContext } from "../src/context.js";
import { contentFiles, gitRunner, type ContentFiles, type GitRunner } from "../src/index.js";
import { createLogger } from "../src/lib/logger.js";
import { pngBytes, TEST_ORIGIN, testConfig } from "./helpers.js";

/** Entries per collection: one at the target, two small ones. Each entry has three files. */
const ENTRIES: Record<string, number> = { news: 1_000, projects: 150, team: 150 };
/** With the entries' files, 5,000 files in the content root. */
const SHARED_IMAGES = 1_100;

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
    for (let index = 0; index < ENTRIES[name]!; index++) {
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

describe("read budgets at the 1.0 target", () => {
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
      // The shared images and one cover in each entry's folder.
      const entries = Object.values(ENTRIES).reduce((sum, count) => sum + count, 0);
      assert.equal(((await response.json()) as { items: unknown[] }).items.length, SHARED_IMAGES + entries);
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

describe("write budgets at the 1.0 target", () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const pending = async () => (await ctx.services.staging.status()).changes;
  const publishAll = async (message: string) => {
    const paths = Object.fromEntries((await pending()).map((change) => [change.path, change.revision ?? null]));
    return ctx.services.staging.publish({ message, paths });
  };

  it("lists 1,000 entries without reading a file's bytes", async () => {
    const { ms } = await measure(async () => {
      const response = await request("/api/admin/collections/news/entries");
      assert.equal(((await response.json()) as { items: unknown[] }).items.length, ENTRIES["news"]);
    });
    assert.equal(log.readBinary.length, 0);
    assert.ok(ms < 3_000, `${ms} ms`);
  });

  it("shows and publishes a deletion without a Git call for each file", async () => {
    await ctx.services.content.remove("news", "news-10");
    const status = await measure(pending);
    assert.ok(log.git.length <= 12, log.git.join("\n"));
    assert.ok(status.ms < 5_000, `status: ${status.ms} ms`);

    const published = await measure(() => publishAll("Delete news 10"));
    assert.ok(log.git.length <= 40, `${log.git.length} Git calls`);
    assert.ok(published.ms < 5_000, `publish: ${published.ms} ms`);
    assert.equal(git("status", "--porcelain"), "");
  });

  it("shows a URL change and checks a media deletion within budget", async () => {
    const entry = await ctx.services.content.get("news", "news-11");
    await ctx.services.content.save("news", { slug: "news-11", data: { ...entry!.data, slug: "news-11-moved" } });
    const status = await measure(pending);
    assert.ok(status.ms < 5_000, `status: ${status.ms} ms`);
    await publishAll("Move news 11");

    const uses = await measure(() => ctx.services.content.mediaUses(["news/news-12/media/cover.png", "media/image-5.png"]));
    assert.equal(log.readBinary.length, 0);
    assert.ok(uses.ms < 5_000, `media uses: ${uses.ms} ms`);
  });

  it("lets five editors save and publish at the same time", async () => {
    const editor = async (index: number) => {
      for (let round = 0; round < 3; round++) {
        const slug = `news-${100 + index}`;
        const entry = await ctx.services.content.get("news", slug);
        await ctx.services.content.save("news", { slug, data: { ...entry!.data, title: `Editor ${index}, round ${round}` } });
        const mine = (await pending()).filter((change) => change.path.startsWith(`news/${slug}/`));
        const paths = Object.fromEntries(mine.map((change) => [change.path, change.revision ?? null]));
        await ctx.services.staging.publish({ message: `Editor ${index}, round ${round}`, paths });
      }
    };
    const { ms } = await measure(() => Promise.all([0, 1, 2, 3, 4].map(editor)));
    assert.equal(git("status", "--porcelain"), "");
    assert.equal(Number(git("rev-list", "--count", "--grep=round", "HEAD")), 15);
    assert.ok(ms < 30_000, `${ms} ms`);
  });
});

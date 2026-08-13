/**
 * The dev-server integration and the manifest it emits.
 *
 * Drives the hooks the way Astro does, without an Astro. The fakes stay down to
 * what the integration actually touches: a watcher, an HTTP server that can
 * close, and `refreshContent`.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { collection, defineSite, singleton, slug, text } from "@micacms/model";

import { manifestFor, mica } from "../dist/index.js";

const site = defineSite({
  collections: {
    projects: collection({ label: "Projects", fields: { title: text(), slug: slug() } }),
  },
  singletons: {
    theme: singleton({ label: "Theme", fields: { primaryColor: text() } }),
  },
});

const CONTENT_ROOT = "./test-content";

function setup(options: { debounceMs?: number; refreshContent?: () => Promise<void> } = {}) {
  const logs: string[] = [];
  const refreshes: Array<Record<string, unknown> | undefined> = [];
  const httpServer = new EventEmitter();
  const watcher = new EventEmitter() as EventEmitter & { add(path: string): void };
  const added: string[] = [];
  watcher.add = (path: string) => void added.push(path);

  const integration = mica({ site, root: CONTENT_ROOT, debounceMs: options.debounceMs ?? 5 });

  return {
    logs,
    refreshes,
    added,
    httpServer,
    watcher,
    integration,
    done: () => integration.hooks["astro:server:done"]?.({ logger: logger(logs) } as never),
    start: (withRefresh = true) =>
      integration.hooks["astro:server:setup"]!({
        server: { httpServer, watcher } as never,
        logger: logger(logs) as never,
        toolbar: {} as never,
        refreshContent: withRefresh
          ? async (refreshOptions) => {
              refreshes.push(refreshOptions?.context);
              await options.refreshContent?.();
            }
          : undefined,
      }),
    /** A file change, as chokidar reports it: an absolute path. */
    touch: (relative: string) =>
      watcher.emit("all", "change", join(resolve(CONTENT_ROOT), relative)),
  };
}

function logger(logs: string[]) {
  return {
    info: (m: string) => logs.push(`info: ${m}`),
    warn: (m: string) => logs.push(`warn: ${m}`),
    error: (m: string) => logs.push(`error: ${m}`),
    debug: (m: string) => logs.push(`debug: ${m}`),
    options: {},
    label: "mica",
    fork: () => logger(logs),
  };
}

/** Debouncing is real here, so assertions wait rather than guess. */
async function waitFor(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

/* ------------------------------------------------------------------ */

describe("content watching", () => {
  it("watches the content root, which Astro's module graph does not reach", async () => {
    const harness = setup();
    await harness.start();

    assert.deepEqual(harness.added, [resolve(CONTENT_ROOT)]);
    harness.done();
  });

  it("reloads when a content file changes", async () => {
    const harness = setup();
    await harness.start();

    harness.touch("projects/haus-a/index.json");
    await waitFor(() => harness.refreshes.length === 1, "the reload");

    harness.done();
  });

  it("coalesces the burst of writes that saving one entry produces", async () => {
    const harness = setup({ debounceMs: 20 });
    await harness.start();

    harness.touch("projects/haus-a/index.json");
    harness.touch("projects/haus-a/description.mdoc");
    harness.touch("projects/_order.json");

    await waitFor(() => harness.refreshes.length === 1, "the reload");
    await new Promise((done) => setTimeout(done, 60));

    assert.equal(harness.refreshes.length, 1, "one save is one reload, not one per file");
    harness.done();
  });

  it("ignores a change outside the content root", async () => {
    const harness = setup();
    await harness.start();

    harness.watcher.emit("all", "change", resolve("src/pages/index.astro"));
    await new Promise((done) => setTimeout(done, 40));

    assert.equal(harness.refreshes.length, 0);
    harness.done();
  });

  it("survives content that fails its own schema", async () => {
    const harness = setup({
      refreshContent: async () => {
        throw new Error("Title is required.");
      },
    });
    await harness.start();

    harness.touch("projects/haus-a/index.json");
    await waitFor(() => harness.logs.some((l) => l.startsWith("error:")), "the reload error");

    // The dev server has to stay up: the next save is very likely the fix.
    harness.touch("projects/haus-a/index.json");
    await waitFor(() => harness.refreshes.length === 2, "the next attempt");

    harness.done();
  });

  it("stops reloading once the dev server closes", async () => {
    const harness = setup();
    await harness.start();

    harness.httpServer.emit("close");
    harness.touch("projects/haus-a/index.json");
    await new Promise((done) => setTimeout(done, 40));

    assert.equal(harness.refreshes.length, 0, "a closed server must not leave a reload pending");
  });

  it("does nothing but warn when Astro cannot refresh content", async () => {
    const harness = setup();
    await harness.start(false);

    harness.touch("projects/haus-a/index.json");
    await new Promise((done) => setTimeout(done, 40));

    assert.equal(harness.refreshes.length, 0);
    assert.ok(harness.logs.some((l) => l.startsWith("warn:") && /[Rr]estart/.test(l)));
  });
});

describe("the protocol manifest", () => {
  it("names the package that generated it", () => {
    const manifest = manifestFor(site);

    assert.equal(manifest.protocolVersion, 1);
    assert.match(manifest.generatedBy, /^@micacms\/astro@/);
    assert.deepEqual(Object.keys(manifest.collections), ["projects"]);
    assert.deepEqual(Object.keys(manifest.singletons), ["theme"]);
  });

  it("is written into the build output, where a static host serves it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mica-build-"));
    const logs: string[] = [];

    try {
      await mica({ site, root: CONTENT_ROOT }).hooks["astro:build:done"]!({
        dir: { pathname: dir } as URL,
        logger: logger(logs) as never,
      } as never);

      const written: unknown = JSON.parse(await readFile(join(dir, "mica-manifest.json"), "utf8"));
      assert.deepEqual(written, JSON.parse(JSON.stringify(manifestFor(site))));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("can be turned off for a project that publishes it another way", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mica-build-"));
    const logs: string[] = [];

    try {
      await mica({ site, manifest: false }).hooks["astro:build:done"]!({
        dir: { pathname: dir } as URL,
        logger: logger(logs) as never,
      } as never);

      await assert.rejects(() => readFile(join(dir, "mica-manifest.json"), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not fail a build that otherwise succeeded", async () => {
    const logs: string[] = [];

    await mica({ site, manifest: "/proc/nonexistent/mica.json" }).hooks["astro:build:done"]!({
      dir: { pathname: "/tmp" } as URL,
      logger: logger(logs) as never,
    } as never);

    assert.ok(logs.some((l) => l.startsWith("warn:")));
  });
});

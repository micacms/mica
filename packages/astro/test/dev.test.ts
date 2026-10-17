/**
 * What a loader does beyond reading: publish the model, and reload in dev.
 *
 * Both used to be an Astro integration. They are here instead because this is
 * the moment the project root, the model and the watcher are all in hand — and
 * because it leaves `astro.config` with no Mica in it, which is what lets a
 * project mix Mica collections with ordinary Astro ones.
 *
 * Driven through a hand-built context, the way Astro drives a loader.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import {
  collection,
  createManifest,
  defineSite,
  MANIFEST_PATH,
  singleton,
  slug,
  text,
} from "@micacms/core/internal";

import { micaCollections, type LoaderContext } from "../dist/index.js";

// Outside CI, the loader writes the model; in CI, it only checks it. These tests write it, except where one says CI.
delete process.env["CI"];

const site = defineSite({
  root: "./content",
  collections: {
    projects: collection({ label: "Projects", fields: { title: text(), slug: slug() } }),
    team: collection({ label: "Team", fields: { name: text(), slug: slug({ from: "name" }) } }),
  },
  singletons: {
    theme: singleton({ label: "Theme", fields: { primaryColor: text() } }),
  },
});

/** A chokidar stand-in: the three events Astro's watcher emits. */
function createWatcher() {
  const emitter = new EventEmitter();
  const added: string[] = [];

  return {
    added,
    watcher: {
      add: (path: string) => void added.push(path),
      on: (event: string, handler: (path: string) => void) => void emitter.on(event, handler),
    },
    emit: (event: "add" | "change" | "unlink", path: string) => emitter.emit(event, path),
  };
}

function createContext(projectRoot: string, watcher?: ReturnType<typeof createWatcher>) {
  const entries = new Map<string, Record<string, unknown>>();
  const logs: string[] = [];
  const loads: number[] = [];

  const context: LoaderContext & { entries: typeof entries; logs: string[]; loads: number[] } = {
    entries,
    logs,
    loads,
    config: { root: pathToFileURL(projectRoot + sep) },
    watcher: watcher?.watcher,
    store: {
      clear: () => entries.clear(),
      set: ({ id, data }) => {
        entries.set(id, data);
        loads.push(Date.now());
        return true;
      },
      keys: () => [...entries.keys()],
    },
    logger: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    meta: { get: () => undefined, set: () => {} },
    parseData: async ({ data }) => data,
    generateDigest: () => "digest",
  };

  return context;
}

/** A project directory with one entry per collection. */
async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mica-dev-"));
  await writeEntry(dir, "projects/haus-a/index.json", { title: "Haus A", slug: "haus-a" });
  await writeEntry(dir, "team/anna/index.json", { name: "Anna", slug: "anna" });
  return dir;
}

async function writeEntry(dir: string, path: string, data: unknown): Promise<void> {
  const target = join(dir, "content", path);
  await rm(target, { force: true });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, JSON.stringify(data), "utf8");
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 5));
  }
}

/* ------------------------------------------------------------------ */

describe("publishing the model", () => {
  it("in CI, fails when the committed model is not the one in the code, and writes nothing", async () => {
    const dir = await project();
    process.env["CI"] = "true";
    try {
      await assert.rejects(micaCollections(site).projects.loader.load(createContext(dir)), /is not the one in the code/);
      await assert.rejects(stat(join(dir, "content", MANIFEST_PATH)));

      delete process.env["CI"];
      await micaCollections(site).projects.loader.load(createContext(dir));
      process.env["CI"] = "true";
      await micaCollections(site).projects.loader.load(createContext(dir));
    } finally {
      delete process.env["CI"];
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes it into the content root, where the repository carries it to Mica", async () => {
    const dir = await project();

    try {
      const collections = micaCollections(site);
      await collections.projects.loader.load(createContext(dir));

      const written: unknown = JSON.parse(
        await readFile(join(dir, "content", MANIFEST_PATH), "utf8"),
      );
      assert.deepEqual(
        written,
        JSON.parse(JSON.stringify(createManifest(site, "@micacms/astro"))),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes it once, however many collections load", async () => {
    const dir = await project();

    try {
      const collections = micaCollections(site);
      const context = createContext(dir);

      await collections.projects.loader.load(context);
      await collections.team.loader.load(context);
      await collections.theme.loader.load(context);

      assert.equal(
        context.logs.filter((line) => line.includes("Wrote the content model")).length,
        1,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves an identical file alone, so a dev server does not reload for nothing", async () => {
    const dir = await project();

    try {
      await micaCollections(site).projects.loader.load(createContext(dir));
      const first = await stat(join(dir, "content", MANIFEST_PATH));

      await new Promise((done) => setTimeout(done, 10));
      await micaCollections(site).projects.loader.load(createContext(dir));
      const second = await stat(join(dir, "content", MANIFEST_PATH));

      assert.equal(second.mtimeMs, first.mtimeMs, "the model did not change, so nothing was written");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("can be turned off for a project that is not edited through Mica", async () => {
    const dir = await project();

    try {
      const collections = micaCollections(site, { publishModel: false });
      await collections.projects.loader.load(createContext(dir));

      await assert.rejects(() => readFile(join(dir, "content", MANIFEST_PATH), "utf8"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not fail a build over a content root it cannot write to", async () => {
    /**
     * A *file* standing where the project root should be. Every `mkdir` below
     * it fails with ENOTDIR — on every platform, and for every user including
     * root in a container, which is what a permission bit cannot promise.
     *
     * It used to be `/proc/nonexistent`, which is unwritable on Linux and
     * absent on macOS. On Linux it is worse than unwritable: `mkdir` with
     * `recursive: true` never settles there, so this test hung the suite on
     * CI and passed at home.
     */
    const dir = await mkdtemp(join(tmpdir(), "mica-dev-"));

    try {
      const file = join(dir, "not-a-directory");
      await writeFile(file, "", "utf8");

      const context = createContext(file);
      const collections = micaCollections(site);

      // The read fails too, and that one is fatal — but the model must have
      // warned rather than thrown before it got there.
      await collections.projects.loader.load(context).catch(() => {});

      assert.ok(context.logs.some((line) => line.startsWith("warn:")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("a draft that is not valid yet", () => {
  const refuseHausB = (context: ReturnType<typeof createContext>) => {
    context.parseData = async ({ id, data }) => {
      if (id === "haus-b") throw new Error("title: Title is required.");
      return data;
    };
  };

  it("is left out with a warning in dev, and the rest of the collection loads", async () => {
    const dir = await project();
    await writeEntry(dir, "projects/haus-b/index.json", { slug: "haus-b" });
    try {
      const context = createContext(dir, createWatcher());
      refuseHausB(context);
      await micaCollections(site).projects.loader.load(context);

      assert.deepEqual([...context.entries.keys()], ["haus-a"]);
      assert.ok(context.logs.some((line) => line.startsWith('warn: Left out "projects/haus-b" until it is valid')));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails a build", async () => {
    const dir = await project();
    await writeEntry(dir, "projects/haus-b/index.json", { slug: "haus-b" });
    try {
      const context = createContext(dir);
      refuseHausB(context);
      await assert.rejects(micaCollections(site).projects.loader.load(context), /Title is required/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("reloading in dev", () => {
  it("reloads its own collection when a file under it changes", async () => {
    const dir = await project();
    const watcher = createWatcher();

    try {
      const collections = micaCollections(site);
      const context = createContext(dir, watcher);
      await collections.projects.loader.load(context);

      assert.deepEqual(watcher.added, [join(dir, "content")]);

      await writeEntry(dir, "projects/haus-b/index.json", { title: "Haus B", slug: "haus-b" });
      watcher.emit("add", join(dir, "content", "projects", "haus-b", "index.json"));

      await waitFor(() => context.entries.size === 2, "the reload");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores a change that belongs to another collection", async () => {
    const dir = await project();
    const watcher = createWatcher();

    try {
      const collections = micaCollections(site);
      const context = createContext(dir, watcher);
      await collections.projects.loader.load(context);
      const before = context.loads.length;

      // A project may also have ordinary Astro collections, and Mica's own
      // collections are independent of each other. Neither is any reason to
      // re-read this one.
      watcher.emit("change", join(dir, "content", "team", "anna", "index.json"));
      watcher.emit("change", join(dir, "src", "notes", "one.md"));
      await new Promise((done) => setTimeout(done, 80));

      assert.equal(context.loads.length, before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("says how to load a changed model, which Astro does not reload by itself", async () => {
    const dir = await project();
    const watcher = createWatcher();

    try {
      const context = createContext(dir, watcher);
      await micaCollections(site).projects.loader.load(context);

      watcher.emit("change", join(dir, "src", "mica.ts"));
      assert.ok(context.logs.some((line) => /^warn: src\/mica\.ts changed\. .*save src\/content\.config\.ts/.test(line)), context.logs.join("\n"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores the model it wrote itself", async () => {
    const dir = await project();
    const watcher = createWatcher();

    try {
      const context = createContext(dir, watcher);
      await micaCollections(site).projects.loader.load(context);
      const before = context.loads.length;

      watcher.emit("change", join(dir, "content", MANIFEST_PATH));
      await new Promise((done) => setTimeout(done, 80));

      assert.equal(context.loads.length, before, "publishing the model must not loop");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("coalesces the burst of writes that saving one entry produces", async () => {
    const dir = await project();
    const watcher = createWatcher();

    try {
      const collections = micaCollections(site, { debounceMs: 20 });
      const context = createContext(dir, watcher);
      await collections.projects.loader.load(context);
      const before = context.loads.length;

      // One save: the entry, its rich-text sidecar and the collection order.
      watcher.emit("change", join(dir, "content", "projects", "haus-a", "index.json"));
      watcher.emit("change", join(dir, "content", "projects", "haus-a.mdoc"));
      watcher.emit("change", join(dir, "content", "projects", "_order.json"));

      await waitFor(() => context.loads.length > before, "the reload");
      await new Promise((done) => setTimeout(done, 60));

      assert.equal(context.loads.length, before + 1, "one save is one reload, not one per file");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("survives content that fails its own schema", async () => {
    const dir = await project();
    const watcher = createWatcher();

    try {
      const context = createContext(dir, watcher);
      let failNext = false;
      context.parseData = async ({ data }) => {
        if (failNext) throw new Error("Title is required.");
        return data;
      };

      await micaCollections(site).projects.loader.load(context);

      failNext = true;
      watcher.emit("change", join(dir, "content", "projects", "haus-a", "index.json"));
      await waitFor(() => context.logs.some((l) => l.startsWith('warn: Left out "projects/haus-a"')), "the warning");
      assert.equal(context.entries.size, 0);

      // The dev server has to stay up: the next save is very likely the fix.
      failNext = false;
      const before = context.loads.length;
      watcher.emit("change", join(dir, "content", "projects", "haus-a", "index.json"));
      await waitFor(() => context.loads.length > before, "the next attempt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("registers one watcher, however many times the loader runs", async () => {
    const dir = await project();
    const watcher = createWatcher();

    try {
      const collections = micaCollections(site);
      const context = createContext(dir, watcher);

      await collections.projects.loader.load(context);
      await collections.projects.loader.load(context);

      assert.deepEqual(watcher.added, [join(dir, "content")]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does nothing in a build, where there is no watcher", async () => {
    const dir = await project();

    try {
      const context = createContext(dir);
      await micaCollections(site).projects.loader.load(context);

      assert.equal(context.watcher, undefined);
      assert.equal(context.entries.size, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

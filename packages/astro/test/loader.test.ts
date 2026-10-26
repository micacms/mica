/**
 * The Git-native loaders.
 *
 * Driven through `memorySource`, so a test states the content directory as the
 * files it contains — which is also how a person reads the real thing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

import {
  collection,
  defineSite,
  media,
  memorySource,
  number,
  object,
  richText,
  singleton,
  id,
  text,
} from "@micacms/core/internal";

import { micaCollections, type LoaderContext } from "../src/index.js";

const site = defineSite({
  collections: {
    projects: collection({
      label: "Projects",
      fields: {
        title: text({ required: true }),
        id: id({ from: "title" }),
        year: number(),
        cover: media(),
        description: richText(),
      },
    }),
    team: collection({
      label: "Team",
      // No rich text and no media, so this collection has file layout.
      fields: { name: text({ required: true }), id: id({ from: "name" }) },
    }),
  },
  singletons: {
    theme: singleton({ label: "Theme", fields: { primaryColor: text() } }),
  },
});

const files: Record<string, string> = {
  "projects/haus-a/index.json": JSON.stringify({
    title: "Haus A",
    id: "haus-a",
    year: 2024,
    cover: "media/exterior.jpg",
  }),
  "projects/haus-a/description.mdoc": "# Haus A\n\nA housing project.\n",
  "projects/haus-b/index.json": JSON.stringify({
    title: "Haus B",
    id: "haus-b",
    year: null,
    cover: null,
  }),
  "team/anna-vogt/index.json": JSON.stringify({ name: "Anna Vogt", id: "anna-vogt" }),
  "team/bea-frei/index.json": JSON.stringify({ name: "Bea Frei", id: "bea-frei" }),
  "theme/index.json": JSON.stringify({ primaryColor: "#123456" }),
};

/**
 * Minimal stand-in for Astro's loader context.
 *
 * `parseData` really applies the collection schema, so a payload the model
 * would reject fails here rather than at build time.
 */
/** Astro hands in `image()`; here a path stays a path, so a test can see where it points. */
const image = () => z.string();

function createContext(schemaOf: (context: { image: () => z.ZodType }) => z.ZodType) {
  const schema = schemaOf({ image });
  const store = new Map<string, Record<string, unknown>>();
  const meta = new Map<string, string>();
  const logs: string[] = [];

  const context: LoaderContext & { entries: typeof store; logs: string[] } = {
    entries: store,
    logs,
    store: {
      clear: () => store.clear(),
      set: ({ id, data }) => {
        store.set(id, data);
        return true;
      },
      keys: () => [...store.keys()],
    },
    logger: {
      info: (m) => logs.push(`info: ${m}`),
      warn: (m) => logs.push(`warn: ${m}`),
      error: (m) => logs.push(`error: ${m}`),
      debug: (m) => logs.push(`debug: ${m}`),
    },
    meta: { get: (k) => meta.get(k), set: (k, v) => void meta.set(k, v) },
    async parseData({ data }) {
      return (await schema.parseAsync(data)) as Record<string, unknown>;
    },
    generateDigest: (data) => JSON.stringify(data).length.toString(),
  };

  return context;
}

function build(overrides: Record<string, string> = {}, removed: string[] = []) {
  const merged = { ...files, ...overrides };
  for (const path of removed) delete merged[path];
  return micaCollections(site, { source: memorySource(merged) });
}

/* ------------------------------------------------------------------ */

describe("micaCollections", () => {
  it("produces one content_layer collection per collection and singleton", () => {
    const collections = build();

    assert.deepEqual(Object.keys(collections).sort(), ["projects", "team", "theme"]);
    assert.equal(collections.projects.type, "content_layer");
    assert.equal(collections.projects.loader.name, "mica:projects");
  });

  it("needs no network, no token and no running server", async () => {
    const collections = build();
    const context = createContext(collections.projects.schema);

    // The absence of any fetch stub is the assertion: a loader that reached for
    // the network would fail here rather than pass.
    await collections.projects.loader.load(context);
    assert.equal(context.entries.size, 2);
  });

  // Mica reads an unknown kind as one from a newer version; in the site's own model it is a typo.
  it("refuses a field kind it does not know, such as a typo", () => {
    const site = defineSite({
      collections: {
        notes: collection({ label: "Notes", fields: { title: text(), id: id(), body: { kind: "txet" } as never } }),
      },
    });
    assert.throws(() => micaCollections(site), /collections\.notes: "body" \(txet\)/);
  });

  it("refuses an option it does not know, such as a typo", () => {
    const site = defineSite({
      collections: {
        notes: collection({ label: "Notes", fields: { title: text({ help: "A typo for description." } as never), id: id() } }),
      },
    });
    assert.throws(() => micaCollections(site), /collections\.notes: "title" \(option help\)/);
  });

  it("refuses a second id field in a collection's own fields, and accepts one per language in an object", () => {
    const twice = defineSite({
      collections: { pages: collection({ label: "Pages", fields: { title: text(), id: id(), other: id() } }) },
    });
    assert.throws(() => micaCollections(twice), /id\(\) fields that are not its ID \(other\); its ID is "id"/);

    const languages = defineSite({
      collections: {
        pages: collection({ label: "Pages", fields: { title: text(), id: id(), urls: object({ fields: { de: id(), fr: id() } }) } }),
      },
    });
    assert.doesNotThrow(() => micaCollections(languages));
  });
});

describe("mixing with ordinary Astro collections", () => {
  /**
   * Mica owns the collections in the model and nothing else. A project is free
   * to define its own beside them — a glob of Markdown docs, a fetch from an
   * API — and the two have to coexist in one `collections` export.
   */
  it("returns a plain object, so it can be spread beside other collections", () => {
    const mine = build();

    assert.equal(Object.getPrototypeOf(mine), Object.prototype);
    assert.deepEqual(Object.keys(mine).sort(), ["projects", "team", "theme"]);
    // Own and enumerable: nothing here relies on a getter or a symbol.
    assert.deepEqual(Object.keys(mine), Object.getOwnPropertyNames(mine));
  });

  it("leaves a foreign collection untouched", async () => {
    let foreignLoads = 0;

    const collections = {
      ...build(),
      docs: {
        type: "content_layer" as const,
        loader: {
          name: "glob",
          load: async () => {
            foreignLoads += 1;
          },
        },
        schema: { parseAsync: async (data: unknown) => data },
      },
    };

    assert.deepEqual(Object.keys(collections).sort(), ["docs", "projects", "team", "theme"]);

    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    assert.equal(context.entries.size, 2);
    assert.equal(foreignLoads, 0, "a Mica loader must not reach into another collection");
  });

  it("names its loaders so they can be told apart", () => {
    const mine = build();

    assert.equal(mine.projects.loader.name, "mica:projects");
    assert.equal(mine.theme.loader.name, "mica:theme");
  });
});

describe("collections", () => {
  it("loads directory-shaped entries with their rich-text documents", async () => {
    const collections = build();
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    const entry = context.entries.get("haus-a");
    assert.equal(entry?.title, "Haus A");
    assert.equal(entry?.description, "# Haus A\n\nA housing project.");
  });

  it("loads entries without rich text or media from their folders", async () => {
    const collections = build();
    const context = createContext(collections.team.schema);
    await collections.team.loader.load(context);

    assert.deepEqual([...context.entries.keys()], ["anna-vogt", "bea-frei"]);
    assert.equal(context.entries.get("bea-frei")?.name, "Bea Frei");
  });

  it("resolves a colocated media path against the content root", async () => {
    const collections = build();
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    assert.equal(context.entries.get("haus-a")?.cover, "projects/haus-a/media/exterior.jpg");
  });

  it("treats a leading slash as a path from the content root", async () => {
    const collections = build({
      "projects/haus-a/index.json": JSON.stringify({
        title: "Haus A",
        id: "haus-a",
        cover: "/shared/logo.svg",
      }),
    });
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    assert.equal(context.entries.get("haus-a")?.cover, "shared/logo.svg");
  });

  it("attaches entry metadata under _mica", async () => {
    const collections = build();
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    assert.deepEqual(context.entries.get("haus-b")?._mica, { position: 1, images: [] });
  });

  it("gives the position in the editor's order, with the collection's default sort", async () => {
    const sorted = defineSite({
      collections: { projects: collection({ ...site.collections.projects, defaultSort: { field: "year", direction: "asc" } }) },
    });
    const haus = JSON.stringify({ title: "Haus B", id: "haus-b", year: 2020, cover: null });
    const collections = micaCollections(sorted, {
      source: memorySource({ ...files, "projects/haus-b/index.json": haus, "projects/_order.json": '["haus-a", "haus-b"]' }),
    });
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    const position = (id: string) => (context.entries.get(id)?._mica as { position: number }).position;
    assert.equal(position("haus-b"), 0, "the earlier year first, whatever the manual order says");
    assert.equal(position("haus-a"), 1);
  });

  it("gives the images of the rich text to image(), as paths from the entry's file", async () => {
    const collections = build({
      "projects/haus-a/description.mdoc":
        "![Plan](media/plan.png)\n\n![Logo](/shared/logo.png)\n\n![Web](https://example.com/a.png)\n\n![Public](/photo.jpg)\n\n![Gone](media/gone.png)\n",
      "projects/haus-a/media/plan.png": "png",
      "shared/logo.png": "png",
    });
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    // Only files that exist go to image(); a missing /path may be in public/, a missing relative one is a problem.
    assert.deepEqual((context.entries.get("haus-a")?._mica as { images: unknown }).images, [
      { path: "media/plan.png", src: "./media/plan.png" },
      { path: "/shared/logo.png", src: "../../shared/logo.png" },
    ]);
    assert.deepEqual(context.logs.filter((line) => line.includes("image")), [
      'warn: projects/haus-a: description: The image "media/gone.png" does not exist.',
    ]);
  });

  it("orders entries alphabetically when nothing says otherwise", async () => {
    const collections = build();
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    assert.deepEqual([...context.entries.keys()], ["haus-a", "haus-b"]);
  });

  it("follows _order.json when an editor has arranged the collection", async () => {
    const collections = build({ "projects/_order.json": '["haus-b", "haus-a"]' });
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    assert.deepEqual([...context.entries.keys()], ["haus-b", "haus-a"]);
    assert.equal((context.entries.get("haus-b")?._mica as { position: number }).position, 0);
  });

  it("survives an order file that has drifted from the directory", async () => {
    const collections = build({ "projects/_order.json": '["gone", "haus-b"]' });
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    // "gone" is dropped; "haus-a" is unmentioned and keeps its place after.
    assert.deepEqual([...context.entries.keys()], ["haus-b", "haus-a"]);
  });

  it("ignores files the model did not put there", async () => {
    const collections = build({
      "projects/README.md": "Notes for the team.",
      "team/notes.txt": "not an entry",
    });
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    assert.deepEqual([...context.entries.keys()], ["haus-a", "haus-b"]);
  });

  it("loads an empty collection without complaint", async () => {
    const collections = build({}, ["projects/haus-a/index.json", "projects/haus-b/index.json"]);
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);

    assert.equal(context.entries.size, 0);
  });

  it("removes an entry that has been deleted from the repository", async () => {
    const collections = build();
    const context = createContext(collections.projects.schema);
    await collections.projects.loader.load(context);
    assert.equal(context.entries.size, 2);

    const fewer = build({}, ["projects/haus-b/index.json"]);
    await fewer.projects.loader.load(context);

    assert.deepEqual([...context.entries.keys()], ["haus-a"]);
  });

  it("names the file when content cannot be parsed", async () => {
    const collections = build({ "projects/haus-a/index.json": "{ not json" });
    const context = createContext(collections.projects.schema);

    await assert.rejects(
      () => collections.projects.loader.load(context),
      /projects\/haus-a\/index\.json/,
    );
  });

  it("warns about a missing media file, and goes on", async () => {
    const collections = build();
    const context = createContext(collections.projects.schema);

    await collections.projects.loader.load(context);
    assert.equal(context.entries.size, 2);
    assert.ok(
      context.logs.includes('warn: projects/haus-a: cover: The file "projects/haus-a/media/exterior.jpg" does not exist.'),
      context.logs.join("\n"),
    );

    const present = build({ "projects/haus-a/media/exterior.jpg": "jpeg" });
    const quiet = createContext(present.projects.schema);
    await present.projects.loader.load(quiet);
    assert.ok(!quiet.logs.some((line) => line.startsWith("warn:")), quiet.logs.join("\n"));
  });

  it("fails the build on a missing file with strict", async () => {
    const collections = micaCollections(site, { source: memorySource(files), strict: true });
    const context = createContext(collections.projects.schema);

    await assert.rejects(() => collections.projects.loader.load(context), /Broken references:\n {2}projects\/haus-a: cover/);
  });

  it("fails the build when an entry does not satisfy the model", async () => {
    const collections = build({ "projects/haus-a/index.json": JSON.stringify({ id: "haus-a" }) });
    const context = createContext(collections.projects.schema);

    // `title` is required, so this must not quietly load a titleless project.
    await assert.rejects(() => collections.projects.loader.load(context));
  });
});

describe("singletons", () => {
  it("loads a singleton under its own name", async () => {
    const collections = build();
    const context = createContext(collections.theme.schema);
    await collections.theme.loader.load(context);

    assert.deepEqual([...context.entries.keys()], ["theme"]);
    assert.equal(context.entries.get("theme")?.primaryColor, "#123456");
  });

  it("warns rather than fails when the singleton has no content yet", async () => {
    const collections = build({}, ["theme/index.json"]);
    const context = createContext(collections.theme.schema);
    await collections.theme.loader.load(context);

    assert.equal(context.entries.size, 0);
    assert.ok(context.logs.some((line) => line.startsWith("warn:")));
  });
});

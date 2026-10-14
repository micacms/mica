/**
 * Uses a real directory, so each test also checks the files that the repository
 * holds afterwards.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, it } from "node:test";

import {
  collection,
  defineSite,
  media,
  number,
  relation,
  repeater,
  richText,
  singleton,
  slug,
  text,
} from "@micacms/core/internal";

import {
  ConflictError,
  ValidationError,
  createContentStore,
  contentFiles,
  type ContentStore,
} from "../src/index.js";

const site = defineSite({
  collections: {
    projects: collection({
      label: "Projects",
      labelSingular: "Project",
      sortable: true,
      fields: {
        title: text({ required: true }),
        slug: slug({ from: "title" }),
        year: number(),
        cover: media(),
        description: richText(),
        lead: relation({ collection: "team" }),
      },
    }),
    team: collection({
      label: "Team",
      fields: { name: text({ required: true }), slug: slug({ from: "name" }) },
    }),
  },
  singletons: {
    theme: singleton({ label: "Theme", fields: { primaryColor: text() } }),
    home: singleton({ label: "Home", fields: { owner: relation({ collection: "team" }) } }),
    about: singleton({ label: "About", fields: { intro: richText() } }),
  },
});

let root = "";
let store: ContentStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mica-store-"));
  store = createContentStore(site, contentFiles({ root }));
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const files = async (path: string) => (await readdir(join(root, path))).sort();
const read = (path: string) => readFile(join(root, path), "utf8");

describe("saving an entry", () => {
  it("writes the entry's fields and rich text into its folder", async () => {
    const saved = await store.save("projects", {
      data: { title: "Haus A", description: "# Overview" },
    });

    assert.equal(saved.slug, "haus-a");
    assert.equal(saved.title, "Haus A");
    assert.deepEqual(await files("projects/haus-a"), ["description.mdoc", "index.json"]);
    assert.equal(await read("projects/haus-a/description.mdoc"), "# Overview\n");
  });

  it("gives an entry without rich text or media a folder too", async () => {
    await store.save("team", { data: { name: "Anna Vogt" } });

    assert.deepEqual(await files("team"), ["anna-vogt"]);
    assert.deepEqual(await files("team/anna-vogt"), ["index.json"]);
  });

  it("derives a slug from the title and keeps it unique", async () => {
    const first = await store.save("projects", { data: { title: "Haus A" } });
    const second = await store.save("projects", { data: { title: "Haus A" } });

    assert.equal(first.slug, "haus-a");
    assert.equal(second.slug, "haus-a-2");
  });

  it("reads back exactly what was saved", async () => {
    await store.save("projects", {
      data: {
        title: "Haus A",
        year: 2024,
        description: "Body text.",
        // Root-relative, as `get` and an upload return it.
        cover: "projects/haus-a/media/photo.jpg",
      },
    });

    const entry = await store.get("projects", "haus-a");
    assert.equal(entry?.data.title, "Haus A");
    assert.equal(entry?.data.year, 2024);
    assert.equal(entry?.data.description, "Body text.");
    assert.equal(entry?.data.cover, "projects/haus-a/media/photo.jpg");
  });

  it("stores a colocated media path relative to the entry", async () => {
    await store.save("projects", {
      data: { title: "Haus A", year: 2024, cover: "projects/haus-a/media/photo.jpg" },
    });

    const onDisk = JSON.parse(await read("projects/haus-a/index.json"));
    assert.equal(onDisk.cover, "media/photo.jpg");
  });

  it("does not accumulate the entry directory over repeated saves", async () => {
    await store.save("projects", {
      data: { title: "Haus A", year: 2024, cover: "projects/haus-a/media/photo.jpg" },
    });

    // Saving what `get` returned must not bury the media path one directory deeper each time.
    for (let round = 0; round < 3; round += 1) {
      const current = await store.get("projects", "haus-a");
      await store.save("projects", { data: { ...current!.data }, slug: "haus-a" });
    }

    const entry = await store.get("projects", "haus-a");
    assert.equal(entry?.data.cover, "projects/haus-a/media/photo.jpg");
  });

  it("stores a media value with alt text relative to the entry, and reads it back", async () => {
    const withAlt = defineSite({
      collections: {
        projects: collection({
          label: "Projects",
          fields: { title: text(), slug: slug({ from: "title" }), cover: media({ alt: "required" }) },
        }),
      },
    });
    const altStore = createContentStore(withAlt, contentFiles({ root }));
    const cover = { path: "projects/haus-a/media/photo.jpg", alt: "The house from the street" };
    await altStore.save("projects", { data: { title: "Haus A", cover } });

    assert.deepEqual(JSON.parse(await read("projects/haus-a/index.json")).cover, {
      path: "media/photo.jpg",
      alt: "The house from the street",
    });
    assert.deepEqual((await altStore.get("projects", "haus-a"))?.data.cover, cover);
  });

  it("keeps a media path from outside the entry pointing where it did", async () => {
    await store.save("projects", {
      data: { title: "Haus A", year: 2024, cover: "media/shared-logo.svg" },
    });

    const entry = await store.get("projects", "haus-a");
    assert.equal(entry?.data.cover, "media/shared-logo.svg");
  });

  it("refuses a payload the model rejects, and names the fields", async () => {
    const error = await store
      .save("projects", { data: { title: "Haus A", year: "soon" } })
      .then(() => null, (caught: unknown) => caught);

    assert.ok(error instanceof ValidationError);
    assert.ok(error.issues.some((issue) => issue.path === "year"));
    assert.deepEqual(await readdir(root), []);
  });

  it("saves an entry that misses a required value, which Publish then refuses", async () => {
    const saved = await store.save("projects", { data: { slug: "draft", year: 2024 } });
    assert.equal(saved.slug, "draft");
  });

  it("refuses an entry with neither a title nor a URL", async () => {
    await assert.rejects(store.save("projects", { data: { year: 2024 } }), /needs a title or a URL/);
    assert.deepEqual(await readdir(root), []);
  });

  it("removes the document of a rich-text field that was cleared", async () => {
    await store.save("projects", { data: { title: "Haus A", description: "Body." } });
    assert.ok((await files("projects/haus-a")).includes("description.mdoc"));

    const revision = await store.revisionOf("projects", "haus-a");
    await store.save("projects", {
      slug: "haus-a",
      data: { title: "Haus A", slug: "haus-a", description: "" },
      expectedRevision: revision,
    });

    assert.deepEqual(await files("projects/haus-a"), ["index.json"]);
  });
});

describe("renaming an entry", () => {
  it("moves the directory, and its media with it", async () => {
    await store.save("projects", { data: { title: "Haus A", description: "Body." } });

    // Stands in for an upload.
    await contentFiles({ root }).apply({
      changes: [
        { type: "write", path: "projects/haus-a/media/photo.jpg", contents: "bytes" },
      ],
    });

    const revision = await store.revisionOf("projects", "haus-a");
    const saved = await store.save("projects", {
      slug: "haus-a",
      data: {
        title: "Haus B",
        slug: "haus-b",
        description: "Body.",
        cover: "projects/haus-a/media/photo.jpg",
      },
      expectedRevision: revision,
    });

    assert.equal(saved.slug, "haus-b");
    assert.equal(saved.renamed, true);
    assert.deepEqual(await files("projects"), ["haus-b"]);
    assert.equal(await read("projects/haus-b/media/photo.jpg"), "bytes");
    // The reference follows the file instead of naming the deleted directory.
    assert.equal(JSON.parse(await read("projects/haus-b/index.json")).cover, "media/photo.jpg");
    assert.equal(await read("projects/haus-b/description.mdoc"), "Body.\n");
  });
});

describe("concurrency", () => {
  it("refuses a save based on a revision that has moved", async () => {
    await store.save("projects", { data: { title: "Haus A" } });
    const stale = await store.revisionOf("projects", "haus-a");

    await store.save("projects", {
      slug: "haus-a",
      data: { title: "Haus A", slug: "haus-a", year: 2024 },
      expectedRevision: stale,
    });

    await assert.rejects(
      () =>
        store.save("projects", {
          slug: "haus-a",
          data: { title: "Haus A", slug: "haus-a", year: 1999 },
          expectedRevision: stale,
        }),
      ConflictError,
    );

    const entry = await store.get("projects", "haus-a");
    assert.equal(entry?.data.year, 2024, "the first save must survive");
  });

  it("refuses a save after another file of the entry changed — the body edited on the website", async () => {
    await store.save("projects", { data: { title: "Haus A", description: "Old body" } });
    const opened = await store.revisionOf("projects", "haus-a");

    // A fast-forward brings a new body, and only the body.
    const [body] = (await files("projects/haus-a")).filter((name) => name.endsWith(".mdoc"));
    await writeFile(join(root, "projects/haus-a", body!), "New body from the website\n");

    await assert.rejects(
      () =>
        store.save("projects", {
          slug: "haus-a",
          data: { title: "Haus A", slug: "haus-a", description: "Old body" },
          expectedRevision: opened,
        }),
      ConflictError,
    );
    assert.equal(await readFile(join(root, "projects/haus-a", body!), "utf8"), "New body from the website\n");
  });

  it("refuses a create that would overwrite an entry added in the meantime", async () => {
    await store.save("projects", { data: { title: "Haus A" } });

    await assert.rejects(
      () =>
        store.save("projects", {
          slug: "haus-a",
          data: { title: "Haus A", slug: "haus-a" },
          expectedRevision: null,
        }),
      ConflictError,
    );
  });

  it("returns a revision the next save is allowed to use", async () => {
    const first = await store.save("projects", { data: { title: "Haus A" } });

    assert.equal(
      first.revision,
      await store.revisionOf("projects", "haus-a"),
      "a save must report the entry's new revision, not the commit's identity",
    );

    const second = await store.save("projects", {
      slug: "haus-a",
      data: { title: "Haus A", slug: "haus-a", year: 2024 },
      expectedRevision: first.revision,
    });

    assert.equal(second.revision, await store.revisionOf("projects", "haus-a"));
  });

  it("returns a revision the next save is allowed to use, after a rename", async () => {
    const first = await store.save("projects", { data: { title: "Haus A" } });

    // The rename writes a different path, so the revision must name the new one.
    const renamed = await store.save("projects", {
      slug: "haus-a",
      data: { title: "Haus B", slug: "haus-b" },
      expectedRevision: first.revision,
    });

    assert.equal(renamed.slug, "haus-b");
    assert.equal(renamed.revision, await store.revisionOf("projects", "haus-b"));

    await store.save("projects", {
      slug: "haus-b",
      data: { title: "Haus B", slug: "haus-b", year: 2024 },
      expectedRevision: renamed.revision,
    });
  });

  it("returns a revision the next save of a singleton is allowed to use", async () => {
    const first = await store.saveSingleton("theme", { primaryColor: "#001122" });

    assert.equal(first.revision, await store.revisionOfSingleton("theme"));

    // A second save without a reload.
    const second = await store.saveSingleton(
      "theme",
      { primaryColor: "#334455" },
      { expectedRevision: first.revision },
    );

    assert.equal(second.revision, await store.revisionOfSingleton("theme"));
  });
});

// The content arrived before the model that reads it (#217).
describe("a model that is older than the content", () => {
  it("keeps the keys and the rich text that it does not declare, also on a URL change", async () => {
    await store.save("projects", { data: { title: "Haus A", description: "Body." } });
    const stored = JSON.parse(await read("projects/haus-a/index.json"));
    await writeFile(join(root, "projects/haus-a/index.json"), JSON.stringify({ ...stored, client: "Stadt Zürich" }));
    await writeFile(join(root, "projects/haus-a/summary.mdoc"), "From a newer model.\n");

    const revision = await store.revisionOf("projects", "haus-a");
    await store.save("projects", { slug: "haus-a", data: { title: "Haus A", description: "" }, expectedRevision: revision });
    assert.equal(JSON.parse(await read("projects/haus-a/index.json")).client, "Stadt Zürich");
    // The declared rich text that was cleared goes; the undeclared file stays.
    assert.deepEqual(await files("projects/haus-a"), ["index.json", "summary.mdoc"]);

    const before = await store.revisionOf("projects", "haus-a");
    await store.save("projects", { slug: "haus-a", data: { title: "Haus A", slug: "haus-b" }, expectedRevision: before });
    assert.equal(JSON.parse(await read("projects/haus-b/index.json")).client, "Stadt Zürich");
    assert.equal(await read("projects/haus-b/summary.mdoc"), "From a newer model.\n");
  });
});

describe("defaults (#221)", () => {
  it("fill a singleton that has no file yet, and never a cleared value", async () => {
    const withDefault = defineSite({
      collections: {},
      singletons: { banner: singleton({ label: "Banner", fields: { text: richText({ default: "Hello" }) } }) },
    });
    const banner = createContentStore(withDefault, contentFiles({ root }));
    assert.deepEqual(await banner.getSingleton("banner"), { text: "Hello" });

    await banner.saveSingleton("banner", { text: "" });
    assert.deepEqual(await banner.getSingleton("banner"), { text: null });
  });
});

describe("deleting an entry", () => {
  it("removes the whole directory", async () => {
    await store.save("projects", { data: { title: "Haus A", description: "Body." } });
    await store.remove("projects", "haus-a");

    assert.deepEqual(await files("projects"), []);
  });

  it("reports what still points at the entry", async () => {
    await store.save("team", { data: { name: "Anna Vogt" } });
    await store.save("projects", { data: { title: "Haus A", lead: "anna-vogt" } });

    const references = await store.findReferences("team", "anna-vogt");
    assert.deepEqual(references, [{ kind: "entry", collection: "projects", slug: "haus-a", title: "Haus A" }]);
  });
});

describe("ordering", () => {
  it("records a manual order as one small file", async () => {
    await store.save("projects", { data: { title: "Haus A" } });
    await store.save("projects", { data: { title: "Haus B" } });

    const revision = await store.reorder("projects", ["haus-b", "haus-a"], null);

    assert.equal(await read("projects/_order.json"), '[\n  "haus-b",\n  "haus-a"\n]\n');
    const listed = (await store.list("projects")).map((entry) => entry.slug);
    assert.deepEqual(listed, ["haus-b", "haus-a"]);
    assert.equal(revision, await store.orderRevision("projects"));
  });

  it("refuses an order based on one that a colleague changed since", async () => {
    await store.save("projects", { data: { title: "Haus A" } });
    await store.save("projects", { data: { title: "Haus B" } });
    await store.reorder("projects", ["haus-b", "haus-a"], null);

    await assert.rejects(() => store.reorder("projects", ["haus-a", "haus-b"], null), /changed this order/);
    assert.equal(await read("projects/_order.json"), '[\n  "haus-b",\n  "haus-a"\n]\n');
  });

  it("a renamed entry keeps its place in the order", async () => {
    await store.save("projects", { data: { title: "Haus A" } });
    await store.save("projects", { data: { title: "Haus B" } });
    await store.reorder("projects", ["haus-b", "haus-a"], null);
    const revision = await store.revisionOf("projects", "haus-b");

    await store.save("projects", {
      slug: "haus-b",
      data: { title: "Haus B", slug: "haus-c", year: 2024 },
      expectedRevision: revision,
    });

    assert.equal(await read("projects/_order.json"), '[\n  "haus-c",\n  "haus-a"\n]\n');
  });

  it("refuses to reorder a collection the model does not call sortable", async () => {
    await assert.rejects(() => store.reorder("team", [], null), /not manually sortable/);
  });
});

describe("singletons", () => {
  it("opens an empty form before anything has been filled in", async () => {
    assert.deepEqual(await store.getSingleton("theme"), { primaryColor: null });
  });

  it("saves and reads back", async () => {
    await store.saveSingleton("theme", { primaryColor: "#123456" });

    assert.equal(await read("theme/index.json"), '{\n  "primaryColor": "#123456"\n}\n');
    assert.deepEqual(await store.getSingleton("theme"), { primaryColor: "#123456" });
  });

  it("keeps a singleton's rich text in its folder", async () => {
    await store.saveSingleton("about", { intro: "Hello." });

    assert.deepEqual(await files("about"), ["index.json", "intro.mdoc"]);
    assert.equal((await store.getSingleton("about")).intro, "Hello.");
  });
});

describe("findReferences", () => {
  it("finds an entry that links from a nested field", async () => {
    const nested = defineSite({
      collections: {
        team: collection({ label: "Team", fields: { name: text(), slug: slug({ from: "name" }) } }),
        events: collection({
          label: "Events",
          fields: {
            title: text(),
            slug: slug({ from: "title" }),
            talks: repeater({ fields: { speaker: relation({ collection: "team" }) } }),
          },
        }),
      },
    });
    const nestedStore = createContentStore(nested, contentFiles({ root }));
    await nestedStore.save("team", { data: { name: "Anna" } });
    await nestedStore.save("events", { data: { title: "Meetup", talks: [{ speaker: "anna" }] } });

    assert.deepEqual(await nestedStore.findReferences("team", "anna"), [
      { kind: "entry", collection: "events", slug: "meetup", title: "Meetup" },
    ]);
  });
});

describe("a URL change with its links", () => {
  const setUp = async () => {
    await store.save("team", { data: { name: "Anna" } });
    await store.save("projects", { data: { title: "Haus A", lead: "anna", description: "Body." } });
    await store.saveSingleton("home", { owner: "anna" });
    return store.revisionOf("team", "anna");
  };

  it("points the links in other entries and settings at the new URL, and leaves their other files alone", async () => {
    const revision = await setUp();
    const body = await read("projects/haus-a/description.mdoc");

    const saved = await store.save("team", {
      slug: "anna",
      data: { name: "Anna", slug: "anna-meier" },
      expectedRevision: revision,
      updateLinks: true,
    });

    assert.equal(saved.relinked, 2);
    assert.equal(JSON.parse(await read("projects/haus-a/index.json")).lead, "anna-meier");
    assert.equal(JSON.parse(await read("home/index.json")).owner, "anna-meier");
    assert.equal(await read("projects/haus-a/description.mdoc"), body);
  });

  it("leaves the links as they are without the option", async () => {
    const revision = await setUp();
    const saved = await store.save("team", { slug: "anna", data: { name: "Anna", slug: "anna-meier" }, expectedRevision: revision });

    assert.equal(saved.relinked, 0);
    assert.equal(JSON.parse(await read("projects/haus-a/index.json")).lead, "anna");
    assert.deepEqual(await store.findReferences("team", "anna"), [
      { kind: "entry", collection: "projects", slug: "haus-a", title: "Haus A" },
      { kind: "singleton", name: "home", title: "Home" },
    ]);
  });

  it("leaves a read-only referrer alone, and names it as read-only", async () => {
    const revision = await setUp();
    const readOnly = new Map([["collections.projects", "Upgrade Mica to edit it."]]);
    const guarded = createContentStore(site, contentFiles({ root }), readOnly);

    const references = await guarded.findReferences("team", "anna");
    assert.deepEqual(references[0], { kind: "entry", collection: "projects", slug: "haus-a", title: "Haus A", readOnly: true });

    const saved = await guarded.save("team", { slug: "anna", data: { name: "Anna", slug: "anna-meier" }, expectedRevision: revision, updateLinks: true });
    assert.equal(saved.relinked, 1);
    assert.equal(JSON.parse(await read("projects/haus-a/index.json")).lead, "anna");
  });

  it("refuses, and writes nothing, when a referrer changes during the save", async () => {
    const revision = await setUp();
    const files = contentFiles({ root });
    // A colleague saves the referrer between the read and the write.
    const racing: typeof files = {
      ...files,
      async apply(input) {
        await writeFile(join(root, "home/index.json"), JSON.stringify({ owner: "anna", note: "colleague" }));
        return files.apply(input);
      },
    };
    const raced = createContentStore(site, racing);

    await assert.rejects(
      raced.save("team", { slug: "anna", data: { name: "Anna", slug: "anna-meier" }, expectedRevision: revision, updateLinks: true }),
      /An entry or page that links here changed while you saved/,
    );
    assert.equal(JSON.parse(await read("team/anna/index.json")).slug, "anna");
    assert.equal(JSON.parse(await read("home/index.json")).note, "colleague");
  });
});

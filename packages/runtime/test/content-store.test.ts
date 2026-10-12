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
  richText,
  singleton,
  slug,
  text,
} from "@micacms/core";

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
      // No rich text and no media: file layout.
      label: "Team",
      fields: { name: text({ required: true }), slug: slug({ from: "name" }) },
    }),
  },
  singletons: {
    theme: singleton({ label: "Theme", fields: { primaryColor: text() } }),
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
  it("writes the entry as the layout describes it", async () => {
    const saved = await store.save("projects", {
      data: { title: "Haus A", description: "# Overview" },
    });

    assert.equal(saved.slug, "haus-a");
    assert.equal(saved.title, "Haus A");
    assert.deepEqual(await files("projects/haus-a"), ["description.mdoc", "index.json"]);
    assert.equal(await read("projects/haus-a/description.mdoc"), "# Overview\n");
  });

  it("writes a file-shaped collection as one JSON document", async () => {
    await store.save("team", { data: { name: "Anna Vogt" } });

    assert.deepEqual(await files("team"), ["anna-vogt.json"]);
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

  it("keeps a media path from outside the entry pointing where it did", async () => {
    await store.save("projects", {
      data: { title: "Haus A", year: 2024, cover: "media/shared-logo.svg" },
    });

    const entry = await store.get("projects", "haus-a");
    assert.equal(entry?.data.cover, "media/shared-logo.svg");
  });

  it("refuses a payload the model rejects, and names the fields", async () => {
    const error = await store
      .save("projects", { data: { year: 2024 } })
      .then(() => null, (caught: unknown) => caught);

    assert.ok(error instanceof ValidationError);
    assert.ok(error.issues.some((issue) => issue.path === "title"));
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
    assert.deepEqual(references, [{ collection: "projects", slug: "haus-a", title: "Haus A" }]);
  });
});

describe("ordering", () => {
  it("records a manual order as one small file", async () => {
    await store.save("projects", { data: { title: "Haus A" } });
    await store.save("projects", { data: { title: "Haus B" } });

    await store.reorder("projects", ["haus-b", "haus-a"]);

    assert.equal(await read("projects/_order.json"), '[\n  "haus-b",\n  "haus-a"\n]\n');
    const listed = (await store.list("projects")).map((entry) => entry.slug);
    assert.deepEqual(listed, ["haus-b", "haus-a"]);
  });

  it("a renamed entry keeps its place in the order", async () => {
    await store.save("projects", { data: { title: "Haus A" } });
    await store.save("projects", { data: { title: "Haus B" } });
    await store.reorder("projects", ["haus-b", "haus-a"]);
    const revision = await store.revisionOf("projects", "haus-b");

    await store.save("projects", {
      slug: "haus-b",
      data: { title: "Haus B", slug: "haus-c", year: 2024 },
      expectedRevision: revision,
    });

    assert.equal(await read("projects/_order.json"), '[\n  "haus-c",\n  "haus-a"\n]\n');
  });

  it("refuses to reorder a collection the model does not call sortable", async () => {
    await assert.rejects(() => store.reorder("team", []), /not manually sortable/);
  });
});

describe("singletons", () => {
  it("opens an empty form before anything has been filled in", async () => {
    assert.deepEqual(await store.getSingleton("theme"), { primaryColor: null });
  });

  it("saves and reads back", async () => {
    await store.saveSingleton("theme", { primaryColor: "#123456" });

    assert.equal(await read("theme.json"), '{\n  "primaryColor": "#123456"\n}\n');
    assert.deepEqual(await store.getSingleton("theme"), { primaryColor: "#123456" });
  });

  it("uses directory layout when the singleton has rich text", async () => {
    await store.saveSingleton("about", { intro: "Hello." });

    assert.deepEqual(await files("about"), ["index.json", "intro.mdoc"]);
    assert.equal((await store.getSingleton("about")).intro, "Hello.");
  });
});

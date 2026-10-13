/** `mica import` moves Astro collections into Mica, from Astro's own data store. */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  collection,
  createManifest,
  date,
  defineSite,
  object,
  MANIFEST_PATH,
  media,
  relation,
  richText,
  singleton,
  slug,
  tags,
  text,
} from "@micacms/core";

import { checkContent } from "../src/check.js";
import { unflatten } from "../src/devalue.js";
import { importCollections } from "../src/import.js";

/** The flattened `devalue` format that Astro writes, for the values a data store holds. */
function flatten(root: unknown): unknown[] {
  const out: unknown[] = [];
  const add = (value: unknown): number => {
    if (value === undefined) return -1;
    const index = out.push(null) - 1;
    if (value instanceof Map) out[index] = ["Map", ...[...value].flatMap(([k, v]) => [add(k), add(v)])];
    else if (value instanceof Date) out[index] = ["Date", value.toISOString()];
    else if (Array.isArray(value)) out[index] = value.map(add);
    else if (value !== null && typeof value === "object") {
      out[index] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, add(v)]));
    } else out[index] = value;
    return index;
  };
  add(root);
  return out;
}

const site = defineSite({
  collections: {
    team: collection({ label: "Team", fields: { name: text(), slug: slug({ from: "name" }) } }),
    blog: collection({
      label: "Blog",
      sortable: true,
      fields: {
        title: text({ required: true }),
        slug: slug({ from: "title" }),
        published: date(),
        updated: date({ includeTime: true }),
        seo: object({ fields: { title: text() } }),
        author: relation({ collection: "team" }),
        cover: media({ accept: "image", alt: "required" }),
        topics: tags(),
        body: richText(),
      },
    }),
  },
  singletons: { settings: singleton({ label: "Settings", fields: { siteName: text() } }) },
});

let project = "";
let root = "";

const write = (file: string, contents: string | object) => {
  const target = path.join(project, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof contents === "string" ? contents : JSON.stringify(contents));
};

const store = (collections: Record<string, Array<Record<string, unknown>>>) => {
  const map = new Map<string, unknown>([["meta::meta", new Map([["astro-version", "7.2.9"]])]]);
  for (const [name, entries] of Object.entries(collections)) map.set(name, new Map(entries.map((entry) => [entry["id"], entry])));
  write("store.json", flatten(map));
  return path.join(project, "store.json");
};

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "mica-import-"));
  root = path.join(project, "content");
  write(`content/${MANIFEST_PATH}`, createManifest(site, "test"));
  write("src/content/blog/photo.jpg", "jpeg");
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

describe("devalue", () => {
  it("reads what Astro writes: maps, dates, nested objects and undefined", () => {
    const value = new Map([["a", { when: new Date("2026-01-15T00:00:00Z"), list: [1, undefined, "x"] }]]);
    const back = unflatten(flatten(value)) as Map<string, { when: Date; list: unknown[] }>;
    assert.equal(back.get("a")!.when.toISOString(), "2026-01-15T00:00:00.000Z");
    assert.deepEqual(back.get("a")!.list, [1, undefined, "x"]);
  });
});

describe("mica import", () => {
  it("converts dates, references, images with alt text, the body and the order", async () => {
    const from = store({
      team: [{ id: "anna", data: { name: "Anna" }, filePath: "src/content/team/anna.md" }],
      blog: [
        {
          id: "2026/second-post",
          data: { title: "Second", published: new Date("2026-02-01T00:00:00Z"), author: { collection: "team", id: "anna" }, image: "__ASTRO_IMAGE_./photo.jpg", imageAlt: "A photo", order: 2, topics: ["astro", " web ", "Astro"] },
          body: "# Second\n\nText.\n",
          filePath: "src/content/blog/second.md",
        },
        { id: "first", data: { title: "First", order: 1, topics: "news, mica" }, body: "First.", filePath: "src/content/blog/first.md" },
      ],
      settings: [{ id: "settings", data: { siteName: "Example" } }],
    });

    const result = await importCollections({
      root,
      project,
      store: from,
      map: { "blog.cover": "image", "blog.cover.alt": "imageAlt" },
      order: { blog: "order" },
    });

    assert.deepEqual(result.imported.map((item) => `${item.name}:${item.entries}`).sort(), ["blog:2", "settings:1", "team:1"]);
    assert.deepEqual(result.problems, []);
    const second = JSON.parse(readFileSync(path.join(root, "blog/2026-second-post/index.json"), "utf8"));
    assert.deepEqual(second, {
      title: "Second",
      slug: "2026-second-post",
      published: "2026-02-01",
      updated: null,
      seo: { title: null },
      author: "anna",
      cover: { path: "media/photo.jpg", alt: "A photo" },
      topics: ["astro", "web"],
    });
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "blog/first/index.json"), "utf8")).topics, ["news", "mica"]);
    assert.ok(existsSync(path.join(root, "blog/2026-second-post/media/photo.jpg")));
    assert.equal(readFileSync(path.join(root, "blog/2026-second-post/body.mdoc"), "utf8"), "# Second\n\nText.\n");
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "blog/_order.json"), "utf8")), ["first", "2026-second-post"]);
    assert.equal(JSON.parse(readFileSync(path.join(root, "settings.json"), "utf8")).siteName, "Example");
    assert.deepEqual((await checkContent(root)).problems.filter((problem) => problem.level === "error"), []);
  });

  it("names keys that it did not import, two ids that give one slug, and a missing image", async () => {
    const from = store({
      blog: [
        { id: "Hello", data: { title: "A", tags: ["x"], image: "__ASTRO_IMAGE_./gone.jpg" }, filePath: "src/content/blog/a.md" },
        { id: "hello", data: { title: "B" }, filePath: "src/content/blog/b.md" },
      ],
    });
    const result = await importCollections({ root, project, store: from, map: { "blog.cover": "image" }, only: ["blog"] });

    assert.ok(result.problems.some((line) => line.includes('"hello" and "Hello" both become "hello"')), result.problems.join("\n"));
    assert.ok(result.problems.some((line) => line.includes('the file "./gone.jpg" does not exist')), result.problems.join("\n"));
    assert.ok(result.problems.some((line) => line === "blog: not imported: tags. Map them with --map, or leave them out."), result.problems.join("\n"));
  });

  it("does not write over a collection that is already in the content root", async () => {
    write("content/blog/old.json", "{}");
    const from = store({ blog: [{ id: "a", data: { title: "A" } }] });
    await assert.rejects(importCollections({ root, project, store: from, only: ["blog"] }), /content root\. Delete it/);
  });
});

describe("mica import, edge cases", () => {
  it("keeps the time of a date with time, fills an object from a flat key, and maps the body", async () => {
    const from = store({
      blog: [{ id: "a", data: { title: "A", updated: new Date("2026-03-05T10:00:00Z"), metaTitle: "Meta" }, body: "Text.", filePath: "src/content/blog/a.md" }],
    });
    const result = await importCollections({ root, project, store: from, only: ["blog"], map: { "blog.seo.title": "metaTitle" } });
    const a = JSON.parse(readFileSync(path.join(root, "blog/a/index.json"), "utf8"));
    assert.equal(a.updated, "2026-03-05T10:00:00.000Z");
    assert.deepEqual(a.seo, { title: "Meta" });
    assert.deepEqual(result.problems, []);
  });

  it("names a body that no field took", async () => {
    const plain = defineSite({ collections: { notes: collection({ label: "Notes", fields: { title: text(), slug: slug({ from: "title" }) } }) } });
    write(`content/${MANIFEST_PATH}`, createManifest(plain, "test"));
    const from = store({ notes: [{ id: "a", data: { title: "A" }, body: "Lost?", filePath: "src/content/notes/a.md" }] });
    const result = await importCollections({ root, project, store: from });
    assert.ok(result.problems.some((line) => line.includes("not imported: the Markdown body")), result.problems.join("\n"));
  });

  it("refuses an id that gives no slug, before it writes anything", async () => {
    const from = store({
      team: [{ id: "anna", data: { name: "Anna" } }],
      blog: [{ id: "---", data: { title: "A" } }],
    });
    await assert.rejects(importCollections({ root, project, store: from }), /the id "---" gives no slug/);
    assert.ok(!existsSync(path.join(root, "team")));
  });
});

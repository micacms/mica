/** `mica migrate-layout` moves entries that a model change left in the other layout (#65). */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { collection, createManifest, defineSite, MANIFEST_PATH, media, repeater, richText, singleton, slug, text } from "@micacms/core";

import { checkContent, type CheckReport } from "../src/check.js";
import { formatMigration, migrateLayout } from "../src/migrate.js";

let root = "";

/** Every problem of a report, errors and warnings, as "path: message". */
const problems = (report: CheckReport) => report.problems.map((problem) => `${problem.path}: ${problem.message}`);

const write = (file: string, contents: string | object) => {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof contents === "string" ? contents : JSON.stringify(contents));
};
const model = (folders: boolean) =>
  defineSite({
    collections: {
      team: collection({
        label: "Team",
        fields: { name: text(), slug: slug({ from: "name" }), ...(folders ? { portrait: media(), bio: richText() } : {}) },
      }),
    },
    singletons: { settings: singleton({ label: "Settings", fields: folders ? { logo: media() } : { title: text() } }) },
  });

beforeEach(() => (root = mkdtempSync(path.join(tmpdir(), "mica-migrate-"))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("mica migrate-layout", () => {
  it("moves files into folders when a media field was added", async () => {
    write(MANIFEST_PATH, createManifest(model(true), "test"));
    write("team/anna.json", { name: "Anna", slug: "anna" });
    write("settings.json", { logo: null });

    const result = await migrateLayout(root);
    assert.deepEqual(result.moved, [
      { from: "team/anna.json", to: "team/anna/index.json" },
      { from: "settings.json", to: "settings/index.json" },
    ]);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "team/anna/index.json"), "utf8")), { name: "Anna", slug: "anna" });
    assert.equal((await checkContent(root)).problems.filter((problem) => problem.level === "error").length, 0);
  });

  it("moves folders into files when the last media and rich-text fields went, and lists what it removes", async () => {
    write(MANIFEST_PATH, createManifest(model(false), "test"));
    write("team/anna/index.json", { name: "Anna", slug: "anna" });
    write("team/anna/bio.mdoc", "Hello.\n");
    write("team/anna/media/portrait.jpg", "jpeg");
    write("team/anna/notes.txt", "mine");

    const result = await migrateLayout(root);
    assert.deepEqual(result.moved, [{ from: "team/anna/index.json", to: "team/anna.json" }]);
    assert.deepEqual(result.removed.sort(), ["team/anna/bio.mdoc", "team/anna/media/portrait.jpg"]);
    assert.deepEqual(result.kept, ["team/anna/notes.txt (not written by Mica)"]);
    assert.ok(existsSync(path.join(root, "team/anna.json")));
    assert.ok(!existsSync(path.join(root, "team/anna/media")));
    assert.match(formatMigration(result), /moved {4}team\/anna\/index\.json -> team\/anna\.json/);
  });

  it("moves an entry named index inside its collection", async () => {
    write(MANIFEST_PATH, createManifest(model(true), "test"));
    write("team/index.json", { name: "Index", slug: "index" });

    const result = await migrateLayout(root);
    assert.deepEqual(result.moved, [{ from: "team/index.json", to: "team/index/index.json" }]);
    assert.ok(existsSync(path.join(root, "team/index/index.json")));
  });

  it("keeps media that another entry still uses", async () => {
    const site = defineSite({
      collections: {
        team: collection({ label: "Team", fields: { name: text(), slug: slug({ from: "name" }) } }),
        news: collection({ label: "News", fields: { title: text(), slug: slug({ from: "title" }), cover: media() } }),
      },
    });
    write(MANIFEST_PATH, createManifest(site, "test"));
    write("team/anna/index.json", { name: "Anna", slug: "anna" });
    write("team/anna/media/shared.jpg", "jpeg");
    write("team/anna/media/old.jpg", "jpeg");
    write("news/hello/index.json", { title: "Hello", slug: "hello", cover: "/team/anna/media/shared.jpg" });

    const result = await migrateLayout(root);
    assert.deepEqual(result.removed, ["team/anna/media/old.jpg"]);
    assert.deepEqual(result.kept, ["team/anna/media/shared.jpg (another entry uses it)"]);
    assert.ok(existsSync(path.join(root, "team/anna/media/shared.jpg")));
  });

  it("does not overwrite an entry that exists in both layouts", async () => {
    write(MANIFEST_PATH, createManifest(model(true), "test"));
    write("team/anna.json", { name: "Old", slug: "anna" });
    write("team/anna/index.json", { name: "New", slug: "anna" });

    const result = await migrateLayout(root);
    assert.deepEqual(result.moved, []);
    assert.match(result.conflicts[0]!, /team\/anna\.json: team\/anna\/index\.json exists too/);
    assert.equal(JSON.parse(readFileSync(path.join(root, "team/anna/index.json"), "utf8")).name, "New");
  });

  it("says so when there is nothing to change", async () => {
    write(MANIFEST_PATH, createManifest(model(false), "test"));
    write("team/anna.json", { name: "Anna", slug: "anna" });
    assert.match(formatMigration(await migrateLayout(root)), /Nothing to change/);
  });

  it("gives repeater rows with rich text their keys and names their files by the keys (#220)", async () => {
    const site = defineSite({
      collections: {
        pages: collection({
          label: "Pages",
          fields: { title: text(), slug: slug({ from: "title" }), sections: repeater({ fields: { heading: text(), text: richText() } }) },
        }),
      },
      singletons: {},
    });
    write(MANIFEST_PATH, createManifest(site, "test"));
    write("pages/about/index.json", { title: "About", slug: "about", sections: [{ heading: "One", extra: "kept" }, { heading: "Two" }] });
    write("pages/about/sections.0.text.mdoc", "First.\n");
    write("pages/about/sections.1.text.mdoc", "Second.\n");
    write("pages/about/sections.7.text.mdoc", "A row that is gone.\n");
    assert.ok(problems(await checkContent(root)).some((line) => line.includes("migrate-layout")));

    const result = await migrateLayout(root);
    const rows = JSON.parse(readFileSync(path.join(root, "pages/about/index.json"), "utf8")).sections as Array<Record<string, unknown>>;
    assert.deepEqual(result.keyed, [{ entry: "pages/about/index.json", renamed: 2 }]);
    assert.deepEqual(result.kept, ["pages/about/sections.7.text.mdoc (no row or rich-text field reads it)"]);
    assert.deepEqual(Object.keys(rows[0]!), ["_key", "heading", "extra"]);
    assert.equal(readFileSync(path.join(root, `pages/about/sections.${rows[1]!["_key"]}.text.mdoc`), "utf8"), "Second.\n");
    assert.equal(existsSync(path.join(root, "pages/about/sections.0.text.mdoc")), false);
    // The key the model does not have is kept, and only reported, as before.
    assert.deepEqual(problems(await checkContent(root)), [
      "pages/about/index.json: sections.0.extra: the model has no such field. Mica drops it on the next save.",
      "pages/about/sections.7.text.mdoc: Not read: the list has no such row. The next save in Mica deletes the file.",
    ]);
    assert.doesNotMatch(formatMigration(await migrateLayout(root)), /keyed|error/);
  });
});

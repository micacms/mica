/**
 * The migration recipes on the website (#121) run, and the page shows them as
 * they are in `recipes/`, so that a copied script is a tested script.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { collection, createManifest, defineSite, MANIFEST_PATH, object, richText, serializeEntry, slug, text } from "../dist/index.js";

const RECIPES = join(import.meta.dirname, "../recipes");
const PAGE = join(import.meta.dirname, "../../../sites/micacms/content/docs/model-changes/body.mdoc");

const roots: string[] = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** A content root with the files given, and the manifest of a small model. */
function content(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "mica-recipe-"));
  roots.push(root);
  const site = defineSite({
    collections: {
      people: collection({ label: "People", fields: { name: text(), slug: slug(), role: text() } }),
      notes: collection({ label: "Notes", fields: { title: text(), slug: slug(), body: richText() } }),
    },
  });
  const all = { [MANIFEST_PATH]: createManifest(site, "test"), ...files };
  for (const [path, value] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}

function run(recipe: string, ...args: string[]): void {
  const result = spawnSync(process.execPath, [join(RECIPES, recipe), ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

const json = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("the migration recipes", () => {
  it("rename a field and keep its place in the file", () => {
    const root = content({ "people/ana/index.json": { name: "Ana", title: "Lead", slug: "ana" }, "people/ben/index.json": { name: "Ben" } });
    run("rename-field.mjs", root, "people", "title", "role");
    assert.deepEqual(Object.entries(json(root, "people/ana/index.json")), [["name", "Ana"], ["role", "Lead"], ["slug", "ana"]]);
    assert.deepEqual(json(root, "people/ben/index.json"), { name: "Ben" });
  });

  it("move text into a Markdoc file, one paragraph per line, with markup kept as text", () => {
    const root = content({ "notes/one/index.json": { title: "One", body: "Price: *not* final\n\n#1 on the list\n1. Preis\n- dash\n---" } });
    run("text-to-rich-text.mjs", root, "notes", "body");
    assert.deepEqual(json(root, "notes/one/index.json"), { title: "One" });
    assert.equal(
      readFileSync(join(root, "notes/one/body.mdoc"), "utf8"),
      "Price: \\*not\\* final\n\n\\#1 on the list\n\n1\\. Preis\n\n\\- dash\n\n\\---\n",
    );
  });

  it("rename a rich-text field by renaming its file, and refuse to overwrite", () => {
    const root = content({ "notes/one/index.json": { title: "One" }, "notes/one/text.mdoc": "Hello.\n" });
    run("rename-field.mjs", root, "notes", "text", "body");
    assert.equal(readFileSync(join(root, "notes/one/body.mdoc"), "utf8"), "Hello.\n");

    const taken = content({ "people/ana/index.json": { name: "Ana", title: "Lead", role: "Lead" } });
    const result = spawnSync(process.execPath, [join(RECIPES, "rename-field.mjs"), taken, "people", "title", "role"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /has "role" already/);
  });

  it("refuse to fill rich text, and name an unknown collection", () => {
    const root = content({});
    for (const args of [["notes", "body", '"x"'], ["nothing", "role", '"x"']]) {
      const result = spawnSync(process.execPath, [join(RECIPES, "fill-field.mjs"), root, ...args], { encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /rich text|no collection "nothing"/);
    }
  });

  it("fill a field only where it is empty", () => {
    const root = content({ "people/ana/index.json": { name: "Ana", role: "Lead" }, "people/ben/index.json": { name: "Ben", role: null } });
    run("fill-field.mjs", root, "people", "role", '"Consultant"');
    assert.equal(json(root, "people/ana/index.json").role, "Lead");
    assert.equal(json(root, "people/ben/index.json").role, "Consultant");
  });

  it("are on the website as they are here", () => {
    const page = readFileSync(PAGE, "utf8");
    for (const recipe of readdirSync(RECIPES)) {
      assert.ok(page.includes(readFileSync(join(RECIPES, recipe), "utf8").trim()), `${recipe} differs from the page`);
    }
  });
});

describe("the multilingual pattern on the website", () => {
  it("stores one Markdoc file for each language, as a later `localized` option will", () => {
    const fields = {
      slug: slug(),
      title: object({ fields: { de: text(), en: text() } }),
      body: object({ fields: { de: richText(), en: richText() } }),
    };
    const stored = serializeEntry(fields, { slug: "about", title: { de: "Über uns", en: "About us" }, body: { de: "Text.", en: "Text." } });
    assert.deepEqual(Object.keys(stored.documents).sort(), ["body.de.mdoc", "body.en.mdoc"]);
    assert.deepEqual(JSON.parse(stored.data).title, { de: "Über uns", en: "About us" });
  });
});

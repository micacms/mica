/** `mica init` adds Mica to an Astro project and never overwrites a file. */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { pathToFileURL } from "node:url";

import { createManifest, MANIFEST_PATH, type Site } from "@micacms/core/internal";

import { initProject, InitError, MODEL } from "../src/init.js";

let project = "";

const write = (file: string, contents: string) => {
  mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  writeFileSync(path.join(project, file), contents);
};

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "mica-init-"));
  write("package.json", JSON.stringify({ dependencies: { astro: "^7.0.0" } }));
});

afterEach(() => rmSync(project, { recursive: true, force: true }));

describe("mica init", () => {
  it("writes the model and the collections", () => {
    const result = initProject(project);
    assert.deepEqual(result.created, ["src/mica.ts", "src/content.config.ts"]);
    assert.match(readFileSync(path.join(project, "src/mica.ts"), "utf8"), /defineSite\(/);
    assert.match(readFileSync(path.join(project, "src/content.config.ts"), "utf8"), /micaCollections\(site\)/);
    assert.ok(result.next.some((step) => step.includes("npm install @micacms/astro @micacms/core")));
  });

  it("keeps existing files, and says how to add Mica to an existing content config", () => {
    write("src/mica.ts", "// mine\n");
    write("src/content.config.ts", "export const collections = {};\n");
    const result = initProject(project);
    assert.deepEqual(result.kept, ["src/mica.ts", "src/content.config.ts"]);
    assert.equal(readFileSync(path.join(project, "src/mica.ts"), "utf8"), "// mine\n");
    assert.equal(readFileSync(path.join(project, "src/content.config.ts"), "utf8"), "export const collections = {};\n");
    assert.ok(result.next.some((step) => step.includes("...micaCollections(site)")));
  });

  it("writes the starter's model, and the starter's schema.json is the one that model writes", async () => {
    const starter = path.resolve(import.meta.dirname, "../../../examples/starter");
    assert.equal(MODEL, readFileSync(path.join(starter, "src/mica.ts"), "utf8"));

    // Here, so that `@micacms/core` resolves from this package.
    const dir = mkdtempSync(path.join(import.meta.dirname, ".starter-"));
    try {
      writeFileSync(path.join(dir, "mica.ts"), MODEL);
      const { site } = (await import(pathToFileURL(path.join(dir, "mica.ts")).href)) as { site: Site };
      const written = JSON.parse(readFileSync(path.join(starter, "content", MANIFEST_PATH), "utf8")) as unknown;
      assert.deepEqual(JSON.parse(JSON.stringify(createManifest(site, "@micacms/astro"))), written);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is the model that the getting-started page shows", () => {
    const page = readFileSync(path.resolve(import.meta.dirname, "../../../sites/micacms/content/docs/getting-started/body.mdoc"), "utf8");
    assert.ok(page.includes(`\`\`\`ts\n${MODEL}\`\`\``), "the page shows another model");
  });

  it("keeps a legacy src/content/config.ts instead of adding a second config", () => {
    write("src/content/config.ts", "export const collections = {};\n");
    assert.ok(initProject(project).kept.includes("src/content/config.ts"));
  });

  it("refuses a package.json that is not JSON, with a message instead of a crash", () => {
    write("package.json", "{ not json");
    assert.throws(() => initProject(project), InitError);
  });

  it("names the scripts to add, with astro check only when @astrojs/check is installed", () => {
    const step = () => initProject(project).next.find((line) => line.includes('"scripts"'));
    assert.match(step()!, /"mica": "mica start",\n {2}"check": "mica check"$/);

    rmSync(path.join(project, "src"), { recursive: true });
    write("package.json", JSON.stringify({ dependencies: { astro: "^7.0.0" }, devDependencies: { "@astrojs/check": "^0.9.4" } }));
    assert.match(step()!, /"check": "mica check && astro check"/);
  });

  it("keeps the project's scripts, and puts mica check in front of its own check", () => {
    const step = () => initProject(project).next.find((line) => line.includes('"scripts"'));
    write("package.json", JSON.stringify({ dependencies: { astro: "^7.0.0" }, scripts: { mica: "mica --port 3000", check: "astro check" } }));
    assert.match(step()!, /^Set in "scripts" in package\.json:\n\n {2}"check": "mica check && astro check"$/);

    rmSync(path.join(project, "src"), { recursive: true });
    write("package.json", JSON.stringify({ dependencies: { astro: "^7.0.0" }, scripts: { mica: "mica", check: "mica check" } }));
    assert.equal(step(), undefined);
  });

  it("refuses a directory that is not an Astro project", () => {
    write("package.json", JSON.stringify({ dependencies: { react: "^19.0.0" } }));
    assert.throws(() => initProject(project), InitError);
    rmSync(path.join(project, "package.json"));
    assert.throws(() => initProject(project), /npm create astro@latest/);
  });
});

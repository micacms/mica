/**
 * The content format (#58): each fixture under `fixtures/format/` is read with
 * core and written back byte for byte, and `docs/content-format.md` shows each
 * fixture file as it is, so that every example in the specification is tested.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import {
  declaresDocument,
  documentPath,
  entryFolder,
  INDEX_FILE,
  readCollection,
  readManifest,
  readSingleton,
  relativizeMedia,
  serializeEntry,
  type FieldMap,
} from "../dist/internal.js";
import { fileSystemSource } from "../dist/node.js";

const FIXTURES = join(import.meta.dirname, "fixtures/format");
const SPEC = join(import.meta.dirname, "../../../docs/content-format.md");

/** Every file under `dir`, relative to it. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}

/** Writes an entry back and compares it with the files in its folder. */
function assertRoundTrip(content: string, fields: FieldMap, folder: string, data: Record<string, unknown>): void {
  const stored = JSON.parse(readFileSync(join(content, folder, INDEX_FILE), "utf8")) as Record<string, unknown>;
  const written = serializeEntry(fields, relativizeMedia(fields, data, folder), stored);
  assert.equal(written.data, readFileSync(join(content, folder, INDEX_FILE), "utf8"), `${folder}/${INDEX_FILE}`);

  const onDisk = readdirSync(join(content, folder)).filter((name) => name.endsWith(".mdoc"));
  for (const name of onDisk) {
    // A file that the model does not declare stays as it is; a save never writes it.
    if (!declaresDocument(fields, documentPath(name))) continue;
    assert.equal(written.documents[name], readFileSync(join(content, folder, name), "utf8"), `${folder}/${name}`);
  }
  assert.deepEqual(Object.keys(written.documents).sort(), onDisk.filter((name) => declaresDocument(fields, documentPath(name))).sort());
}

describe("the content format fixtures", () => {
  for (const fixture of readdirSync(FIXTURES)) {
    it(`${fixture}: core reads every entry and writes it back byte for byte`, async () => {
      const content = join(FIXTURES, fixture, "content");
      const { site, readOnly, warnings } = readManifest(JSON.parse(readFileSync(join(FIXTURES, fixture, "model.json"), "utf8")));
      assert.equal(readOnly.size, 0);
      assert.deepEqual(warnings, []);
      const source = fileSystemSource(content);

      for (const [name, def] of Object.entries(site.collections)) {
        for (const entry of await readCollection(source, def, name)) {
          assertRoundTrip(content, def.fields, entryFolder(name, entry.slug), entry.data);
        }
      }
      for (const [name, def] of Object.entries(site.singletons)) {
        const data = await readSingleton(source, def, name);
        if (data) assertRoundTrip(content, def.fields, entryFolder(name), data);
      }
    });
  }

  it("basic: the order file comes first, and the rest follow", async () => {
    const content = join(FIXTURES, "basic/content");
    const { site } = readManifest(JSON.parse(readFileSync(join(FIXTURES, "basic/model.json"), "utf8")));
    const entries = await readCollection(fileSystemSource(content), site.collections["posts"]!, "posts");
    assert.deepEqual(entries.map((entry) => entry.slug), ["second-post", "hello-world"]);
  });

  it("are in the specification as they are here", () => {
    const spec = readFileSync(SPEC, "utf8");
    for (const fixture of readdirSync(FIXTURES)) {
      for (const file of filesUnder(join(FIXTURES, fixture))) {
        if (file === "model.json") continue;
        const text = readFileSync(join(FIXTURES, fixture, file), "utf8").trimEnd();
        assert.ok(spec.includes(text), `${fixture}/${file} differs from docs/content-format.md`);
      }
    }
  });
});

/**
 * Uses a real temporary directory: a fake cannot show atomicity, rollback and
 * traversal refusal.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, afterEach, describe, it } from "node:test";

import { ConflictError, contentFiles, type ContentFiles } from "../src/index.js";

let root = "";
let files: ContentFiles;

const fixture: Record<string, string> = {
  "projects/haus-a/index.json": '{ "title": "Haus A" }',
  "projects/haus-a/description.mdoc": "Text.\n",
  "projects/haus-a/media/photo.jpg": "not really a jpeg",
  "theme.json": '{ "primaryColor": "#123456" }',
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mica-local-"));
  for (const [path, contents] of Object.entries(fixture)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents, "utf8");
  }
  files = contentFiles({ root });
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const read = (path: string) => readFile(join(root, path), "utf8");
const missing = async (path: string) => {
  await assert.rejects(() => readFile(join(root, path), "utf8"));
};

describe("reading", () => {
  it("reads text and bytes", async () => {
    assert.equal(await files.read("theme.json"), '{ "primaryColor": "#123456" }');

    const head = await files.readHead("projects/haus-a/media/photo.jpg", 8);
    assert.equal(Buffer.from(head!).toString("utf8"), "not real");
    const stream = await files.readStream("projects/haus-a/media/photo.jpg");
    assert.equal(await new Response(stream).text(), "not really a jpeg");
  });

  it("returns null for what is not there", async () => {
    assert.equal(await files.read("missing.json"), null);
    assert.equal(await files.readHead("missing.jpg", 8), null);
    assert.equal(await files.readStream("missing.jpg"), null);
    assert.equal(await files.revision("missing.json"), null);
  });

  it("refuses a path that escapes the root", async () => {
    await assert.rejects(() => files.read("../secrets.json"));
    await assert.rejects(() => files.apply({
      changes: [{ type: "write", path: "../escaped.json", contents: "{}" }],
    }));
    await missing("../escaped.json");
  });

  it("never deletes the content root, however the path names it", async () => {
    for (const path of ["", "projects/..", "projects/haus-a/../.."]) {
      await assert.rejects(
        () => files.apply({ changes: [{ type: "deleteTree", path }] }),
        { name: "ContentPathError" },
      );
    }
    assert.equal(await read("theme.json"), '{ "primaryColor": "#123456" }');
  });
});

describe("revisions", () => {
  it("changes when the content changes, and not otherwise", async () => {
    const before = await files.revision("theme.json");

    // Rewritten byte for byte, as a Git checkout does.
    await writeFile(join(root, "theme.json"), '{ "primaryColor": "#123456" }', "utf8");
    assert.equal(await files.revision("theme.json"), before);

    await writeFile(join(root, "theme.json"), '{ "primaryColor": "#000000" }', "utf8");
    assert.notEqual(await files.revision("theme.json"), before);
  });
});

describe("commit", () => {
  it("writes, deletes and removes trees in one call", async () => {
    await files.apply({
      changes: [
        { type: "write", path: "news/one.json", contents: '{ "title": "One" }' },
        { type: "delete", path: "theme.json" },
        { type: "deleteTree", path: "projects/haus-a" },
      ],
    });

    assert.equal(await read("news/one.json"), '{ "title": "One" }');
    await missing("theme.json");
    await missing("projects/haus-a/index.json");
    await missing("projects/haus-a/media/photo.jpg");
  });

  it("creates parent directories for a new entry", async () => {
    await files.apply({
      changes: [{ type: "write", path: "news/first/index.json", contents: "{}" }],
    });

    assert.equal(await read("news/first/index.json"), "{}");
  });

  it("writes bytes as well as text", async () => {
    await files.apply({
      changes: [
        { type: "write", path: "projects/haus-a/media/new.bin", contents: new Uint8Array([1, 2, 3]) },
      ],
    });

    const bytes = await files.readHead("projects/haus-a/media/new.bin", 16);
    assert.deepEqual([...bytes!], [1, 2, 3]);
  });

  it("ignores a delete of something already gone", async () => {
    await files.apply({
      changes: [{ type: "delete", path: "news/never-existed.json" }],
    });
  });

  it("refuses when a path moved under the editor", async () => {
    const revision = await files.revision("theme.json");
    await writeFile(join(root, "theme.json"), '{ "primaryColor": "#999999" }', "utf8");

    const error = await files
      .apply({
        changes: [{ type: "write", path: "theme.json", contents: "{}" }],
        expect: { "theme.json": revision },
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    assert.ok(error instanceof ConflictError);
    assert.deepEqual(error.paths, ["theme.json"]);
    assert.equal(await read("theme.json"), '{ "primaryColor": "#999999" }');
  });

  it("asserts absence with a null revision, so two creates cannot collide", async () => {
    await files.apply({
      changes: [{ type: "write", path: "news/one.json", contents: "{}" }],
      expect: { "news/one.json": null },
    });

    await assert.rejects(
      () =>
        files.apply({
          changes: [{ type: "write", path: "news/one.json", contents: '{ "other": true }' }],
          expect: { "news/one.json": null },
        }),
      ConflictError,
    );

    assert.equal(await read("news/one.json"), "{}");
  });

  it("leaves the tree as it was when a change set fails part-way", async () => {
    await assert.rejects(() =>
      files.apply({
        changes: [
          { type: "write", path: "projects/haus-a/index.json", contents: '{ "title": "Changed" }' },
          { type: "deleteTree", path: "projects/haus-a/media" },
          // Refused by the traversal check, after the two above have applied.
          { type: "write", path: "../escaped.json", contents: "{}" },
        ],
      }),
    );

    assert.equal(await read("projects/haus-a/index.json"), '{ "title": "Haus A" }');
    assert.equal(await read("projects/haus-a/media/photo.jpg"), "not really a jpeg");
  });
});

// The local editor's working tree can hold a symbolic link (#213, N11).
describe("a symbolic link out of the content root", () => {
  it("is not followed for a read, a write or a delete", async () => {
    const outside = await mkdtemp(join(tmpdir(), "mica-outside-"));
    await writeFile(join(outside, "secret.txt"), "outside", "utf8");
    await symlink(outside, join(root, "projects", "linked"));

    await assert.rejects(files.read("projects/linked/secret.txt"), /symbolic link/);
    await assert.rejects(files.apply({ changes: [{ type: "write", path: "projects/linked/new.txt", contents: "x" }] }), /symbolic link/);
    await assert.rejects(files.apply({ changes: [{ type: "deleteTree", path: "projects/linked" }] }), /symbolic link/);
    assert.equal(await readFile(join(outside, "secret.txt"), "utf8"), "outside");
    await rm(outside, { recursive: true, force: true });
  });
});

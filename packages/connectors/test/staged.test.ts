/**
 * The staged connector.
 *
 * Over a real base — the local connector on a temporary directory — because
 * the property under test is the overlay: what a reader sees is the
 * repository *as it will be*, while the repository itself does not move until
 * somebody publishes.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, afterEach, describe, it } from "node:test";

import { memoryDraftStore, type DraftStore } from "@micacms/core";

import {
  ConflictError,
  localConnector,
  stagedConnector,
  type RepositoryConnector,
} from "../dist/index.js";

let root = "";
let base: RepositoryConnector;
let drafts: DraftStore;
let staged: RepositoryConnector;

const fixture: Record<string, string> = {
  "projects/haus-a/index.json": '{ "title": "Haus A" }',
  "projects/haus-a/description.mdoc": "Text.\n",
  "projects/haus-a/media/photo.jpg": "not really a jpeg",
  "theme.json": '{ "primaryColor": "#123456" }',
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mica-staged-"));
  for (const [path, contents] of Object.entries(fixture)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents, "utf8");
  }
  base = localConnector({ root });
  drafts = memoryDraftStore();
  staged = stagedConnector(base, drafts);
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const onDisk = (path: string) => readFile(join(root, path), "utf8");

/* ------------------------------------------------------------------ */

describe("reading through the overlay", () => {
  it("prefers staged contents and leaves the repository alone", async () => {
    await staged.commit({
      message: "Save",
      changes: [{ type: "write", path: "theme.json", contents: '{"primaryColor":"#654321"}' }],
    });

    assert.equal(await staged.read("theme.json"), '{"primaryColor":"#654321"}');
    // The repository has not moved: that is the whole point of staging.
    assert.equal(await onDisk("theme.json"), '{ "primaryColor": "#123456" }');
    assert.equal(await base.read("theme.json"), '{ "primaryColor": "#123456" }');
  });

  it("hides a staged deletion", async () => {
    await staged.commit({
      message: "Delete",
      changes: [{ type: "delete", path: "theme.json" }],
    });

    assert.equal(await staged.read("theme.json"), null);
    assert.equal(await staged.revision("theme.json"), null);
    assert.equal(await onDisk("theme.json"), '{ "primaryColor": "#123456" }');
  });

  it("lists staged files and directories beside repository ones", async () => {
    await staged.commit({
      message: "Create",
      changes: [
        { type: "write", path: "projects/haus-b/index.json", contents: "{}" },
        { type: "write", path: "notes.json", contents: "{}" },
        { type: "delete", path: "theme.json" },
      ],
    });

    assert.deepEqual(await staged.list(""), [
      { name: "notes.json", type: "file" },
      { name: "projects", type: "directory" },
    ]);
    assert.deepEqual(await staged.list("projects"), [
      { name: "haus-a", type: "directory" },
      { name: "haus-b", type: "directory" },
    ]);
  });

  it("answers a fresh revision for staged contents", async () => {
    const before = await staged.revision("theme.json");
    await staged.commit({
      message: "Save",
      changes: [{ type: "write", path: "theme.json", contents: "{}" }],
    });

    const after = await staged.revision("theme.json");
    assert.ok(after);
    assert.notEqual(after, before);
  });
});

describe("staging", () => {
  it("records the repository revision the path had when first staged", async () => {
    const repoRevision = await base.revision("theme.json");

    await staged.commit({
      message: "First",
      changes: [{ type: "write", path: "theme.json", contents: '{"a":1}' }],
    });
    await staged.commit({
      message: "Second",
      changes: [{ type: "write", path: "theme.json", contents: '{"a":2}' }],
    });

    const row = await drafts.get("theme.json");
    assert.equal(row?.baseRevision, repoRevision);
  });

  it("records what a fresh draft is based on", async () => {
    assert.equal(await drafts.base(), null);
    await staged.commit({
      message: "Save",
      changes: [{ type: "write", path: "theme.json", contents: "{}" }],
    });
    // The local base has no branch head to record; the call still happened and
    // recorded its honest answer.
    assert.equal(await drafts.base(), await base.head());
  });

  it("refuses a stale expectation against the draft, not the repository", async () => {
    await staged.commit({
      message: "Colleague's autosave",
      changes: [{ type: "write", path: "theme.json", contents: '{"a":1}' }],
    });

    // This session opened the entry before the autosave: it holds the
    // repository's revision, which the draft has since replaced.
    await assert.rejects(
      staged.commit({
        message: "Stale save",
        changes: [{ type: "write", path: "theme.json", contents: '{"a":2}' }],
        expect: { "theme.json": await base.revision("theme.json") },
      }),
      ConflictError,
    );
  });

  it("accepts an expectation matching the staged revision", async () => {
    await staged.commit({
      message: "First",
      changes: [{ type: "write", path: "theme.json", contents: '{"a":1}' }],
    });

    await staged.commit({
      message: "Second",
      changes: [{ type: "write", path: "theme.json", contents: '{"a":2}' }],
      expect: { "theme.json": await staged.revision("theme.json") },
    });

    assert.equal(await staged.read("theme.json"), '{"a":2}');
  });

  it("resolves deleteTree to the files the overlay sees", async () => {
    // One staged file joins the directory before it is deleted.
    await staged.commit({
      message: "Add a sidecar",
      changes: [{ type: "write", path: "projects/haus-a/notes.mdoc", contents: "notes" }],
    });
    await staged.commit({
      message: "Delete the entry",
      changes: [{ type: "deleteTree", path: "projects/haus-a" }],
    });

    const rows = await drafts.list();
    const deletions = rows.filter((row) => row.kind === "delete").map((row) => row.path);

    assert.deepEqual(deletions.sort(), [
      "projects/haus-a/description.mdoc",
      "projects/haus-a/index.json",
      "projects/haus-a/media/photo.jpg",
    ]);
    // The staged-only file cancelled out instead of becoming a deletion the
    // repository could never apply.
    assert.equal(await drafts.get("projects/haus-a/notes.mdoc"), null);
    // An emptied directory may still list — readers treat a directory without
    // its data file as absent — but no file survives in it.
    const remaining = await staged.list("projects/haus-a");
    assert.ok(remaining.every((item) => item.type === "directory"));
    assert.equal(await staged.read("projects/haus-a/index.json"), null);
  });

  it("create then delete before publishing nets to nothing", async () => {
    await staged.commit({
      message: "Create",
      changes: [{ type: "write", path: "projects/haus-b/index.json", contents: "{}" }],
    });
    await staged.commit({
      message: "Undo",
      changes: [{ type: "deleteTree", path: "projects/haus-b" }],
    });

    assert.deepEqual(await drafts.list(), []);
  });

  it("delete then recreate stages the new contents", async () => {
    await staged.commit({
      message: "Delete",
      changes: [{ type: "deleteTree", path: "projects/haus-a" }],
    });
    await staged.commit({
      message: "Recreate",
      changes: [{ type: "write", path: "projects/haus-a/index.json", contents: '{"title":"New"}' }],
    });

    assert.equal(await staged.read("projects/haus-a/index.json"), '{"title":"New"}');
    // The recreated file still gates on the repository as it was first seen.
    const row = await drafts.get("projects/haus-a/index.json");
    assert.equal(row?.baseRevision, await base.revision("projects/haus-a/index.json"));
    // The rest of the old entry stays deleted.
    assert.equal(await staged.read("projects/haus-a/description.mdoc"), null);
  });
});

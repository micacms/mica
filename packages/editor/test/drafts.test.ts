/**
 * The SQLite draft store.
 *
 * The same behaviour `memoryDraftStore` specifies in @micacms/core, proven
 * against the real schema — plus the one property memory cannot show: bytes
 * survive the round trip through a BLOB column.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openTestDatabase } from "../src/server/db/index.js";
import { createDraftRepository } from "../src/server/repositories/drafts.js";

const bytes = (text: string) => new TextEncoder().encode(text);

const write = (path: string, contents: string, baseRevision: string | null = null) =>
  ({ kind: "write", path, contents: bytes(contents), text: true, baseRevision }) as const;

function makeStore() {
  return createDraftRepository(openTestDatabase());
}

describe("draft repository", () => {
  it("stages and reads back, binary intact", async () => {
    const store = makeStore();
    const blob = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

    await store.stage([
      write("entry/index.json", '{"a":1}', "rev-1"),
      { kind: "write", path: "entry/media/photo.png", contents: blob, text: false, baseRevision: null },
      { kind: "delete", path: "old.json", baseRevision: "rev-2" },
    ]);

    const listed = await store.list();
    assert.deepEqual(
      listed.map((change) => change.path),
      ["entry/index.json", "entry/media/photo.png", "old.json"],
    );

    const media = await store.get("entry/media/photo.png");
    assert.equal(media?.kind, "write");
    if (media?.kind === "write") {
      assert.deepEqual([...media.contents], [...blob]);
      assert.equal(media.text, false);
    }

    const gone = await store.get("old.json");
    assert.equal(gone?.kind, "delete");
    assert.equal(gone?.baseRevision, "rev-2");
  });

  it("re-staging keeps the original base revision and bumps the version", async () => {
    const store = makeStore();
    await store.stage([write("entry.json", "v1", "repo-rev-1")]);
    const first = (await store.get("entry.json"))!;

    await store.stage([write("entry.json", "v2", "draft-rev")]);
    const second = (await store.get("entry.json"))!;

    assert.equal(second.baseRevision, "repo-rev-1");
    assert.ok(second.version > first.version);
  });

  it("clearPublished keeps a row that was re-staged mid-publish", async () => {
    const store = makeStore();
    await store.stage([write("a.json", "a"), write("b.json", "b")]);
    const snapshot = await store.list();

    await store.stage([write("b.json", "b-newer")]);
    await store.clearPublished(snapshot.map(({ path, version }) => ({ path, version })));

    assert.equal(await store.get("a.json"), null);
    assert.notEqual(await store.get("b.json"), null);
  });

  it("keeps the base revision until the draft empties", async () => {
    const store = makeStore();
    await store.stage([write("a.json", "a"), write("b.json", "b")]);
    await store.setBase("head-1");

    await store.discard(["a.json"]);
    assert.equal(await store.base(), "head-1");

    await store.discard(["b.json"]);
    assert.equal(await store.base(), null);
  });

  it("rebase replaces the recorded repository revision", async () => {
    const store = makeStore();
    await store.stage([write("a.json", "a", null)]);
    await store.rebase("a.json", "repo-rev-2");

    assert.equal((await store.get("a.json"))?.baseRevision, "repo-rev-2");
  });

  it("discard reports only what was present", async () => {
    const store = makeStore();
    await store.stage([write("a.json", "a")]);

    assert.deepEqual(await store.discard(["a.json", "missing.json"]), ["a.json"]);
  });
});

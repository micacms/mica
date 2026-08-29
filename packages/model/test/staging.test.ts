import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memoryDraftStore, toContentChange, type StagedChange } from "../dist/index.js";

const bytes = (text: string) => new TextEncoder().encode(text);

const write = (path: string, contents: string, baseRevision: string | null = null) =>
  ({ kind: "write", path, contents: bytes(contents), text: true, baseRevision }) as const;

describe("memoryDraftStore", () => {
  it("stages, lists in staging order, and reads back by path", async () => {
    const store = memoryDraftStore();
    await store.stage([write("b/two.json", "2"), write("a/one.json", "1")]);

    const listed = await store.list();
    assert.deepEqual(
      listed.map((change) => change.path),
      ["b/two.json", "a/one.json"],
    );

    const one = await store.get("a/one.json");
    assert.equal(one?.kind, "write");
    assert.equal(await store.get("missing.json"), null);
  });

  it("re-staging a path keeps the original base revision", async () => {
    const store = memoryDraftStore();
    await store.stage([write("entry.json", "v1", "repo-rev-1")]);
    // The second save arrives with the draft's own revision, which must not
    // replace the publish gate.
    await store.stage([write("entry.json", "v2", "draft-rev")]);

    const row = await store.get("entry.json");
    assert.equal(row?.baseRevision, "repo-rev-1");
    assert.equal(new TextDecoder().decode((row as StagedChange & { kind: "write" }).contents), "v2");
  });

  it("re-staging bumps the version", async () => {
    const store = memoryDraftStore();
    await store.stage([write("entry.json", "v1")]);
    const before = (await store.get("entry.json"))!.version;

    await store.stage([write("entry.json", "v2")]);
    const after = (await store.get("entry.json"))!.version;

    assert.ok(after > before);
  });

  it("a delete replaces a write for the same path", async () => {
    const store = memoryDraftStore();
    await store.stage([write("entry.json", "v1", "repo-rev-1")]);
    await store.stage([{ kind: "delete", path: "entry.json", baseRevision: null }]);

    const row = await store.get("entry.json");
    assert.equal(row?.kind, "delete");
    assert.equal(row?.baseRevision, "repo-rev-1");
  });

  it("clearPublished removes only rows the publication included", async () => {
    const store = memoryDraftStore();
    await store.stage([write("a.json", "a"), write("b.json", "b")]);
    const snapshot = await store.list();

    // An autosave lands while the publish is in flight.
    await store.stage([write("b.json", "b-newer")]);

    await store.clearPublished(snapshot.map(({ path, version }) => ({ path, version })));

    assert.equal(await store.get("a.json"), null);
    const survivor = await store.get("b.json");
    assert.equal(survivor?.kind, "write");
  });

  it("discard reports what was actually removed", async () => {
    const store = memoryDraftStore();
    await store.stage([write("a.json", "a")]);

    assert.deepEqual(await store.discard(["a.json", "missing.json"]), ["a.json"]);
    assert.equal(await store.get("a.json"), null);
  });

  it("forgets the base revision when the draft empties", async () => {
    const store = memoryDraftStore();
    await store.setBase("head-1");
    await store.stage([write("a.json", "a")]);

    await store.discard(["a.json"]);
    assert.equal(await store.base(), null);
  });

  it("rebase replaces the recorded repository revision", async () => {
    const store = memoryDraftStore();
    await store.stage([write("a.json", "a", null)]);
    await store.rebase("a.json", "repo-rev-2");

    assert.equal((await store.get("a.json"))?.baseRevision, "repo-rev-2");
  });
});

describe("toContentChange", () => {
  it("derives create, update and delete from the row", async () => {
    const store = memoryDraftStore();
    await store.stage([
      write("created.json", "new", null),
      write("updated.json", "changed", "repo-rev"),
      { kind: "delete", path: "removed.json", baseRevision: "repo-rev" },
    ]);

    const kinds = Object.fromEntries(
      (await store.list()).map((change) => [change.path, toContentChange(change).kind]),
    );

    assert.deepEqual(kinds, {
      "created.json": "create",
      "updated.json": "update",
      "removed.json": "delete",
    });
  });
});

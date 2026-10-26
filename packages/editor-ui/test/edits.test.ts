/**
 * File changes into edits: the unit every count in the editor uses.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FileChange } from "../src/api.js";
import { blockedEdits, problemsByEdit, publishSummary, reviewedPaths, shownRevisions, toEdits as groupedEdits, withNeeds, withoutDependents } from "../src/lib/edits.js";

/** The group of each file, as the server sends it with the change list. */
function groupOf({ owner, path }: Omit<FileChange, "group">): string {
  if (owner.kind === "entry") return `entry:${owner.collection}/${owner.id}`;
  if (owner.kind === "singleton") return `singleton:${owner.name}`;
  if (owner.kind === "order") return `order:${owner.collection}`;
  return `file:${path}`;
}

const toEdits = (changes: Array<Omit<FileChange, "group">>) => groupedEdits(changes.map((change) => ({ ...change, group: groupOf(change) })));

const renamed = {
  kind: "entry",
  collection: "pages",
  id: "leistungen",
  label: "Page: Leistungen",
  renamedFrom: "services",
} as const;

describe("toEdits", () => {
  it("a URL change is one edit, however many files it moves", () => {
    const fileChanges: FileChange[] = [
      { path: "pages/_order.json", kind: "update", owner: renamed },
      { path: "pages/services/body.mdoc", kind: "delete", owner: renamed },
      { path: "pages/services/index.json", kind: "delete", owner: renamed },
      { path: "pages/leistungen/body.mdoc", kind: "create", owner: renamed },
      { path: "pages/leistungen/index.json", kind: "create", owner: renamed },
    ];

    const edits = toEdits(fileChanges);

    assert.equal(edits.length, 1);
    assert.equal(edits[0]!.fileChanges.length, 5);
    assert.deepEqual(edits[0]!.link, {
      name: "entry",
      params: { collection: "pages", id: "leistungen" },
    });
    assert.deepEqual(edits[0]!.target, {
      kind: "entry",
      collection: "pages",
      id: "leistungen",
      from: "services",
    });
  });

  it("keeps entries, singletons, orders and media apart", () => {
    const about = { kind: "entry", collection: "pages", id: "about", label: "Page: About" } as const;
    const settings = { kind: "singleton", name: "settings", label: "Settings" } as const;
    const order = { kind: "order", collection: "pages", label: "Pages: order" } as const;
    const media = { kind: "media", label: "Shared media" } as const;

    const edits = toEdits([
      { path: "pages/about/index.json", kind: "update", owner: about },
      { path: "pages/about/body.mdoc", kind: "update", owner: about },
      { path: "settings.json", kind: "update", owner: settings },
      { path: "pages/_order.json", kind: "update", owner: order },
      { path: "media/a.png", kind: "create", owner: media },
      { path: "media/b.png", kind: "create", owner: media },
    ]);

    assert.deepEqual(
      edits.map((edit) => [edit.key, edit.fileChanges.length]),
      [
        ["entry:pages/about", 2],
        ["singleton:settings", 1],
        ["order:pages", 1],
        ["file:media/a.png", 1],
        ["file:media/b.png", 1],
      ],
    );
  });

  it("says whether an edit is new, changed or removed, and when it was last saved", () => {
    const page = (id: string) => ({ kind: "entry", collection: "pages", id, label: id }) as const;
    const edits = toEdits([
      { path: "pages/new/index.json", kind: "create", owner: page("new"), savedAt: "2026-10-13T08:00:00.000Z" },
      { path: "pages/new/body.mdoc", kind: "create", owner: page("new"), savedAt: "2026-10-13T09:00:00.000Z" },
      { path: "pages/old.json", kind: "delete", owner: page("old"), savedAt: null },
      { path: "pages/about/index.json", kind: "update", owner: page("about") },
      { path: "pages/about/media/a.png", kind: "create", owner: page("about") },
    ]);

    assert.deepEqual(
      edits.map((edit) => [edit.key, edit.state, edit.savedAt]),
      [
        ["entry:pages/new", "new", "2026-10-13T09:00:00.000Z"],
        ["entry:pages/old", "removed", null],
        ["entry:pages/about", "changed", null],
      ],
    );
    assert.equal(toEdits([{ path: "media/a.png", kind: "create", owner: { kind: "media", label: "Shared media" } }])[0]!.label, "Shared media: a.png");
  });

  it("a URL change is a change, not a new entry", () => {
    assert.equal(
      toEdits([{ path: "pages/leistungen/index.json", kind: "create", owner: renamed }])[0]!.state,
      "changed",
    );
  });

  it("a deleted entry has no link to open", () => {
    const old = { kind: "entry", collection: "pages", id: "old", label: "Page: old" } as const;
    const [edit] = toEdits([{ path: "pages/old.json", kind: "delete", owner: old }]);
    assert.equal(edit!.link, null);
  });

  it("finds the problems of each edit by their file", () => {
    const about = { kind: "entry", collection: "pages", id: "about", label: "About" } as const;
    const edits = toEdits([
      { path: "pages/about/index.json", kind: "update", owner: about },
      { path: "settings.json", kind: "update", owner: { kind: "singleton", name: "settings", label: "Settings" } },
    ]);
    const problems = [{ path: "pages/about/index.json", label: "About", issues: [{ path: "title", message: "Required" }] }];
    assert.deepEqual([...problemsByEdit(edits, problems).keys()], ["entry:pages/about"]);
  });

  it("gives an entry the problem on its unchanged data file", () => {
    const hello = { kind: "entry", collection: "news", id: "hello", label: "Hello" } as const;
    const edits = toEdits([{ path: "news/hello/body.mdoc", kind: "delete", owner: hello }]);
    const problems = [{ path: "news/hello/index.json", label: "Hello", issues: [{ path: "body", message: "Body is required." }] }];
    assert.deepEqual([...problemsByEdit(edits, problems).keys()], ["entry:news/hello"]);
  });

  it("summarises a publication in words the editor can keep", () => {
    const entry = (id: string, kind: FileChange["kind"]) =>
      toEdits([{ path: `pages/${id}.json`, kind, owner: { kind: "entry", collection: "pages", id, label: id } }])[0]!;
    assert.equal(publishSummary([]), "");
    assert.equal(publishSummary([entry("about", "update")]), "Update about");
    assert.equal(publishSummary([entry("a", "create"), entry("b", "create")]), "Add a and b");
    assert.equal(publishSummary([entry("a", "delete")]), "Remove a");
    assert.equal(publishSummary([entry("a", "update"), entry("b", "create"), entry("c", "update"), entry("d", "update")]), "Update a, b and 2 more");
  });

  it("sends every file of the chosen edits with the revision the editor saw", () => {
    const owner = { kind: "entry", collection: "pages", id: "a", label: "a" } as const;
    const edits = toEdits([
      { path: "pages/a/index.json", kind: "update", owner, revision: "r1" },
      { path: "pages/a/old.png", kind: "delete", owner, revision: null },
    ]);
    assert.deepEqual(reviewedPaths(edits), { "pages/a/index.json": "r1", "pages/a/old.png": null });
  });

  it("takes the revisions of the comparison on the page, and sends a file it did not show as unseen", () => {
    const owner = { kind: "entry", collection: "pages", id: "a", label: "a" } as const;
    const edits = toEdits([
      { path: "pages/a/index.json", kind: "update", owner, revision: "r2" },
      { path: "pages/a/body.mdoc", kind: "create", owner, revision: "r9" },
    ]);
    const shown = () => ({ "pages/a/index.json": "r1" });
    assert.deepEqual(reviewedPaths(edits, shown), { "pages/a/index.json": "r1", "pages/a/body.mdoc": "" });
  });

  it("takes the list's revisions while a comparison has not loaded, and refuses after a failed one (#353)", () => {
    const owner = { kind: "entry", collection: "pages", id: "a", label: "a" } as const;
    const edits = toEdits([{ path: "pages/a/index.json", kind: "update", owner, revision: "r2" }]);
    const send = (item: Parameters<typeof shownRevisions>[0]) => reviewedPaths(edits, () => shownRevisions(item));

    assert.deepEqual(send(undefined), { "pages/a/index.json": "r2" });
    assert.deepEqual(send({ loading: true, comparison: null }), { "pages/a/index.json": "r2" });
    assert.deepEqual(send({ loading: false, comparison: { revisions: { "pages/a/index.json": "r1" } } }), { "pages/a/index.json": "r1" });
    assert.deepEqual(send({ loading: false, comparison: null }), { "pages/a/index.json": "" });
  });

  it("keeps an edit with the new edits it needs, both ways", () => {
    const page = (id: string) => ({ kind: "entry", collection: "pages", id, label: id }) as const;
    const edits = toEdits([
      { path: "pages/a.json", kind: "update", owner: page("a"), needs: ["pages/b.json", "media/x.png"] },
      { path: "pages/b.json", kind: "create", owner: page("b"), needs: ["pages/c.json"] },
      { path: "pages/c.json", kind: "create", owner: page("c") },
      { path: "media/x.png", kind: "create", owner: { kind: "media", label: "Shared media" } },
      { path: "pages/d.json", kind: "update", owner: page("d") },
    ]);
    assert.deepEqual(edits[0]!.needs, ["entry:pages/b", "file:media/x.png"]);

    assert.deepEqual([...withNeeds(["entry:pages/a"], edits)].sort(), ["entry:pages/a", "entry:pages/b", "entry:pages/c", "file:media/x.png"]);
    const all = edits.map((edit) => edit.key);
    assert.deepEqual([...withoutDependents(all, "entry:pages/c", edits)].sort(), ["entry:pages/d", "file:media/x.png"]);
    assert.deepEqual([...blockedEdits(edits, new Map([["entry:pages/c", true]]))].sort(), ["entry:pages/a", "entry:pages/b", "entry:pages/c"]);
  });
});

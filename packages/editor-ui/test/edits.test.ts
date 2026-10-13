/**
 * File changes into edits: the unit every count in the editor uses.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FileChange } from "../src/api.js";
import { blockedEdits, problemsByEdit, publishSummary, reviewedPaths, toEdits, withNeeds, withoutDependents } from "../src/lib/edits.js";

const renamed = {
  kind: "entry",
  collection: "pages",
  slug: "leistungen",
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
      params: { collection: "pages", slug: "leistungen" },
    });
    assert.deepEqual(edits[0]!.target, {
      kind: "entry",
      collection: "pages",
      slug: "leistungen",
      from: "services",
    });
  });

  it("keeps entries, singletons, orders and media apart", () => {
    const about = { kind: "entry", collection: "pages", slug: "about", label: "Page: About" } as const;
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
        ["media:media/a.png", 1],
        ["media:media/b.png", 1],
      ],
    );
  });

  it("says whether an edit is new, changed or removed, and when it was last saved", () => {
    const page = (slug: string) => ({ kind: "entry", collection: "pages", slug, label: slug }) as const;
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
    const old = { kind: "entry", collection: "pages", slug: "old", label: "Page: old" } as const;
    const [edit] = toEdits([{ path: "pages/old.json", kind: "delete", owner: old }]);
    assert.equal(edit!.link, null);
  });

  it("finds the problems of each edit by their file", () => {
    const about = { kind: "entry", collection: "pages", slug: "about", label: "About" } as const;
    const edits = toEdits([
      { path: "pages/about/index.json", kind: "update", owner: about },
      { path: "settings.json", kind: "update", owner: { kind: "singleton", name: "settings", label: "Settings" } },
    ]);
    const problems = [{ path: "pages/about/index.json", label: "About", issues: [{ path: "title", message: "Required" }] }];
    assert.deepEqual([...problemsByEdit(edits, problems).keys()], ["entry:pages/about"]);
  });

  it("gives an entry the problem on its unchanged data file", () => {
    const hello = { kind: "entry", collection: "news", slug: "hello", label: "Hello" } as const;
    const edits = toEdits([{ path: "news/hello/body.mdoc", kind: "delete", owner: hello }]);
    const problems = [{ path: "news/hello/index.json", label: "Hello", issues: [{ path: "body", message: "Body is required." }] }];
    assert.deepEqual([...problemsByEdit(edits, problems).keys()], ["entry:news/hello"]);
  });

  it("summarises a publication in words the editor can keep", () => {
    const entry = (slug: string, kind: FileChange["kind"]) =>
      toEdits([{ path: `pages/${slug}.json`, kind, owner: { kind: "entry", collection: "pages", slug, label: slug } }])[0]!;
    assert.equal(publishSummary([]), "");
    assert.equal(publishSummary([entry("about", "update")]), "Update about");
    assert.equal(publishSummary([entry("a", "create"), entry("b", "create")]), "Add a and b");
    assert.equal(publishSummary([entry("a", "delete")]), "Remove a");
    assert.equal(publishSummary([entry("a", "update"), entry("b", "create"), entry("c", "update"), entry("d", "update")]), "Update a, b and 2 more");
  });

  it("sends every file of the chosen edits with the revision the editor saw", () => {
    const owner = { kind: "entry", collection: "pages", slug: "a", label: "a" } as const;
    const edits = toEdits([
      { path: "pages/a/index.json", kind: "update", owner, revision: "r1" },
      { path: "pages/a/old.png", kind: "delete", owner, revision: null },
    ]);
    assert.deepEqual(reviewedPaths(edits), { "pages/a/index.json": "r1", "pages/a/old.png": null });
  });

  it("keeps an edit with the new edits it needs, both ways", () => {
    const page = (slug: string) => ({ kind: "entry", collection: "pages", slug, label: slug }) as const;
    const edits = toEdits([
      { path: "pages/a.json", kind: "update", owner: page("a"), needs: ["pages/b.json", "media/x.png"] },
      { path: "pages/b.json", kind: "create", owner: page("b"), needs: ["pages/c.json"] },
      { path: "pages/c.json", kind: "create", owner: page("c") },
      { path: "media/x.png", kind: "create", owner: { kind: "media", label: "Shared media" } },
      { path: "pages/d.json", kind: "update", owner: page("d") },
    ]);
    assert.deepEqual(edits[0]!.needs, ["entry:pages/b", "media:media/x.png"]);

    assert.deepEqual([...withNeeds(["entry:pages/a"], edits)].sort(), ["entry:pages/a", "entry:pages/b", "entry:pages/c", "media:media/x.png"]);
    const all = edits.map((edit) => edit.key);
    assert.deepEqual([...withoutDependents(all, "entry:pages/c", edits)].sort(), ["entry:pages/d", "media:media/x.png"]);
    assert.deepEqual([...blockedEdits(edits, new Map([["entry:pages/c", true]]))].sort(), ["entry:pages/a", "entry:pages/b", "entry:pages/c"]);
  });
});

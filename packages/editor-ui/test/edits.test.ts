/**
 * File changes into edits: the unit every count in the editor uses.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FileChange } from "../src/api.js";
import { toEdits } from "../src/lib/edits.js";

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
        ["media", 2],
      ],
    );
  });

  it("a deleted entry has no link to open", () => {
    const old = { kind: "entry", collection: "pages", slug: "old", label: "Page: old" } as const;
    const [edit] = toEdits([{ path: "pages/old.json", kind: "delete", owner: old }]);
    assert.equal(edit!.link, null);
  });
});

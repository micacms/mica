/**
 * File changes and edits: the two units of the pending change set.
 *
 * A *file change* is one path the commit writes or deletes — what the server
 * lists and what Publish and Discard act on. An *edit* is one thing an editor
 * recognises: an entry, a singleton, a collection's order, the shared media.
 * One edit is often several file changes (an entry is `index.json` plus its
 * documents and media; a URL change deletes one folder and creates another).
 *
 * Everything an editor reads counts edits — never file changes.
 */

import type { CompareTarget, FileChange } from "@/api";

/** One thing an editor recognises in the pending change set. */
export interface Edit {
  key: string;
  label: string;
  link: { name: string; params?: Record<string, string> } | null;
  fileChanges: FileChange[];
  /** What a before/after comparison would compare — null where none applies. */
  target: CompareTarget | null;
}

/** Groups file changes into edits, by the owner the server named for each file. */
export function toEdits(fileChanges: FileChange[]): Edit[] {
  const byKey = new Map<string, Edit>();

  for (const change of fileChanges) {
    const owner = change.owner;
    const key =
      owner.kind === "entry"
        ? `entry:${owner.collection}/${owner.slug}`
        : owner.kind === "singleton"
          ? `singleton:${owner.name}`
          : owner.kind === "order"
            ? `order:${owner.collection}`
            : owner.kind === "media"
              ? "media"
              : `other:${change.path}`;

    let edit = byKey.get(key);
    if (!edit) {
      edit = {
        key,
        label: owner.label,
        // A rename's edit can start with a deleted file of the old slug.
        link:
          owner.kind === "entry" && (change.kind !== "delete" || owner.renamedFrom)
            ? { name: "entry", params: { collection: owner.collection, slug: owner.slug } }
            : owner.kind === "singleton"
              ? { name: "singleton", params: { name: owner.name } }
              : owner.kind === "media"
                ? { name: "media" }
                : null,
        fileChanges: [],
        target:
          owner.kind === "entry"
            ? {
                kind: "entry",
                collection: owner.collection,
                slug: owner.slug,
                ...(owner.renamedFrom ? { from: owner.renamedFrom } : {}),
              }
            : owner.kind === "singleton"
              ? { kind: "singleton", name: owner.name }
              : owner.kind === "order"
                ? { kind: "order", collection: owner.collection }
                : null,
      };
      byKey.set(key, edit);
    }
    edit.fileChanges.push(change);
  }

  return [...byKey.values()];
}

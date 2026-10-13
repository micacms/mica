/**
 * File changes and edits: the two units of the pending change set.
 *
 * A *file change* is one path that Publish writes or deletes — what the server
 * lists and what Publish and Discard act on. An *edit* is one thing an editor
 * recognises: an entry, a singleton, a collection's order, one shared media file.
 * One edit is often several file changes (an entry is `index.json` plus its
 * documents and media; a URL change deletes one folder and creates another).
 *
 * Everything an editor reads counts edits — never file changes.
 */

import type { CompareTarget, FileChange, StagingProblem } from "@/api";

/** One thing an editor recognises in the pending change set. */
export interface Edit {
  key: string;
  label: string;
  link: { name: string; params?: Record<string, string> } | null;
  fileChanges: FileChange[];
  /** What a before/after comparison would compare — null where none applies. */
  target: CompareTarget | null;
  /** New, changed, or removed when it is published. A URL change is a change. */
  state: "new" | "changed" | "removed";
  /** The latest save of any of its files, null when every file is a deletion. */
  savedAt: string | null;
  /** Keys of the edits that this one uses and cannot be published without. */
  needs: string[];
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
              ? `media:${change.path}`
              : `other:${change.path}`;

    let edit = byKey.get(key);
    if (!edit) {
      edit = {
        key,
        // A shared media file is its own edit, so that it can be published or discarded alone.
        label: owner.kind === "media" ? `${owner.label}: ${change.path.split("/").at(-1)}` : owner.label,
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
        state: "changed",
        savedAt: null,
        needs: [],
      };
      byKey.set(key, edit);
    }
    edit.fileChanges.push(change);
    if (change.savedAt && (!edit.savedAt || change.savedAt > edit.savedAt)) edit.savedAt = change.savedAt;
  }

  const editOf = new Map([...byKey.values()].flatMap((edit) => edit.fileChanges.map((change) => [change.path, edit.key] as const)));
  for (const edit of byKey.values()) {
    edit.state = stateOf(edit);
    const needed = edit.fileChanges.flatMap((change) => change.needs ?? []).map((path) => editOf.get(path));
    edit.needs = [...new Set(needed.filter((key): key is string => key !== undefined && key !== edit.key))];
  }
  return [...byKey.values()];
}

/** Whole-edit words: only creations is new, only deletions is removed. */
function stateOf(edit: Edit): Edit["state"] {
  const kinds = new Set(edit.fileChanges.map((change) => change.kind));
  if (edit.target?.kind === "entry" && edit.target.from) return "changed";
  if (kinds.size === 1 && kinds.has("create")) return "new";
  if (kinds.size === 1 && kinds.has("delete")) return "removed";
  return "changed";
}

/**
 * The problems that belong to each edit. A problem names the document's data
 * file, which may be unchanged while another file of the entry changed (a
 * cleared rich-text field deletes only its `.mdoc`), so an entry or singleton
 * also owns the problems under its own path.
 */
export function problemsByEdit(edits: Edit[], problems: StagingProblem[]): Map<string, StagingProblem[]> {
  const owns = (edit: Edit, path: string): boolean => {
    if (edit.fileChanges.some((change) => change.path === path)) return true;
    const base =
      edit.target?.kind === "entry"
        ? `${edit.target.collection}/${edit.target.slug}`
        : edit.target?.kind === "singleton"
          ? edit.target.name
          : null;
    return base !== null && (path === `${base}.json` || path.startsWith(`${base}/`));
  };
  const result = new Map<string, StagingProblem[]>();
  for (const problem of problems) {
    const edit = edits.find((candidate) => owns(candidate, problem.path));
    if (edit) result.set(edit.key, [...(result.get(edit.key) ?? []), problem]);
  }
  return result;
}

/** A first summary of a publication, which the editor can change: "Update About us and Team". */
export function publishSummary(edits: Edit[]): string {
  if (edits.length === 0) return "";
  const states = new Set(edits.map((edit) => edit.state));
  const verb = states.size === 1 && states.has("new") ? "Add" : states.size === 1 && states.has("removed") ? "Remove" : "Update";
  const [first, second] = edits.map((edit) => edit.label);
  const named =
    edits.length === 1
      ? first
      : edits.length === 2
        ? `${first} and ${second}`
        : `${first}, ${second} and ${edits.length - 2} more`;
  return `${verb} ${named}`.slice(0, 500);
}

/** What Publish sends for the chosen edits: every file of each, at the revision the editor saw. */
export function reviewedPaths(edits: Edit[]): Record<string, string | null> {
  return Object.fromEntries(edits.flatMap((edit) => edit.fileChanges.map((change) => [change.path, change.revision ?? null])));
}

/** The chosen edits plus everything they need, however deep. */
export function withNeeds(keys: Iterable<string>, edits: Edit[]): Set<string> {
  const byKey = new Map(edits.map((edit) => [edit.key, edit]));
  const result = new Set<string>();
  const add = (key: string): void => {
    if (result.has(key) || !byKey.has(key)) return;
    result.add(key);
    for (const needed of byKey.get(key)!.needs) add(needed);
  };
  for (const key of keys) add(key);
  return result;
}

/** The chosen edits without `key` and without every edit that needs it, however deep. */
export function withoutDependents(keys: Iterable<string>, key: string, edits: Edit[]): Set<string> {
  const result = new Set(keys);
  const remove = (gone: string): void => {
    if (!result.delete(gone)) return;
    for (const edit of edits) if (edit.needs.includes(gone)) remove(edit.key);
  };
  remove(key);
  return result;
}

/** Edits that cannot be published now: a problem of their own, or one in what they need. */
export function blockedEdits(edits: Edit[], problems: Map<string, unknown>): Set<string> {
  const blocked = new Set([...problems.keys()]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const edit of edits) {
      if (!blocked.has(edit.key) && edit.needs.some((key) => blocked.has(key))) {
        blocked.add(edit.key);
        grew = true;
      }
    }
  }
  return blocked;
}

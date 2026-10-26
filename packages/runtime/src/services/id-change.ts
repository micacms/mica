/**
 * What a save does when an entry's ID changes: its files move to the new
 * folder, the order keeps its place, and on request the relations in other
 * documents follow the new ID. A new entry's uploads move in the same way.
 */

import {
  type Collection,
  declaresDocument,
  DOCUMENT_EXTENSION,
  documentLinks,
  documentPath,
  entryDataPath,
  type FieldMap,
  INDEX_FILE,
  ORDER_FILE,
  readCollectionEntry,
  readSingleton,
  relativizeMedia,
  relinkReferences,
  serializeEntry,
  type Singleton,
  type Site,
} from "@micacms/core/internal";

import type { ContentFiles, FileChange } from "../workspace/files.js";
import { scanSite, type Referrer } from "./links.js";

/** A document that links to an entry, with what a relink needs. */
export interface LinkingDocument {
  referrer: Referrer;
  fields: FieldMap;
  folder: string;
  /** Reads the data again, so that a relink starts from what is on disk now. */
  read: () => Promise<Record<string, unknown> | null>;
}

/** Entries and settings pages whose relations point at `collection`/`id`. `readOnly` marks the ones this build cannot write. */
export async function linkingDocuments(
  site: Site,
  files: ContentFiles,
  readOnly: ReadonlyMap<string, string>,
  collection: string,
  id: string,
): Promise<LinkingDocument[]> {
  const found: LinkingDocument[] = [];
  await scanSite(
    site,
    files,
    ({ referrer, def, data, folder }) => {
      const points = documentLinks(def.fields, data, folder).some(
        (link) => link.kind === "relation" && link.collection === collection && link.id === id,
      );
      if (!points) return;
      const key = referrer.kind === "entry" ? `collections.${referrer.collection}` : `singletons.${referrer.name}`;
      found.push({
        referrer: readOnly.has(key) ? { ...referrer, readOnly: true } : referrer,
        fields: def.fields,
        folder,
        read: () =>
          referrer.kind === "entry"
            ? readCollectionEntry(files, def as Collection, referrer.collection, referrer.id)
            : readSingleton(files, def as Singleton, referrer.name),
      });
    },
    { where: (fields) => linksTo(fields, collection) },
  );
  return found;
}

/**
 * The data file of each linking document, with its relations to `from` now
 * pointing at `to`, and the revision that each file had before the read: a
 * save in between makes the write refuse, not overwrite it. Only the data file
 * changes; rich text and media stay. A read-only document is left alone.
 */
export async function relinkedFiles(
  files: ContentFiles,
  linking: LinkingDocument[],
  collection: string,
  from: string,
  to: string,
): Promise<{ changes: FileChange[]; revisions: Record<string, string | null> }> {
  const changes: FileChange[] = [];
  const revisions: Record<string, string | null> = {};
  for (const found of linking) {
    if (found.referrer.readOnly) continue;
    const dataFile = `${found.folder}/${INDEX_FILE}`;
    const revision = await files.revision(dataFile);
    const current = await found.read();
    const next = current && relinkReferences(found.fields, current, collection, from, to);
    if (!next) continue;
    const { data: contents } = serializeEntry(found.fields, relativizeMedia(found.fields, next, found.folder), await storedData(files, found.folder));
    changes.push({ type: "write", path: dataFile, contents });
    revisions[dataFile] = revision;
  }
  return { changes, revisions };
}

/** The entry's `index.json` as it is now, whose undeclared keys a save keeps; empty without one. */
export async function storedData(files: ContentFiles, folder: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse((await files.read(`${folder}/${INDEX_FILE}`)) ?? "{}");
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    // Not JSON: the save replaces it, as before.
    return {};
  }
}

/** Whether a field map has a relation to `collection`, nested fields included. */
function linksTo(fields: FieldMap, collection: string): boolean {
  return Object.values(fields).some(
    (field) =>
      (field.kind === "relation" && field.collection === collection) ||
      ((field.kind === "object" || field.kind === "repeater") && linksTo(field.fields, collection)),
  );
}

/**
 * The order file with a renamed ID in its old place, so the entry does not
 * drop to the end of the list.
 */
export async function renameInOrder(files: ContentFiles, name: string, from: string, to: string): Promise<FileChange | null> {
  const path = `${name}/${ORDER_FILE}`;
  const raw = await files.read(path);
  if (raw === null) return null;

  let listed: unknown;
  try {
    listed = JSON.parse(raw);
  } catch {
    // Reading the collection reports a malformed order file; a save need not.
    return null;
  }
  if (!Array.isArray(listed) || !listed.includes(from)) return null;

  const order = listed.map((id: unknown) => (id === from ? to : id));
  return { type: "write", path, contents: `${JSON.stringify(order, null, 2)}\n` };
}

/**
 * Copies the files of a renamed entry that the save does not write: its media,
 * and files that the model does not declare. The caller deletes the old folder.
 */
export async function moveFiles(
  files: ContentFiles,
  fields: FieldMap,
  from: string,
  to: string,
  changes: FileChange[],
): Promise<void> {
  const walk = async (dir: string): Promise<void> => {
    for (const item of await files.list(`${from}${dir}`)) {
      const relative = `${dir}/${item.name}`;
      if (item.type === "directory") {
        await walk(relative);
        continue;
      }
      // Written by the save from the data: `index.json`, and the rich text that the model declares.
      if (relative === `/${INDEX_FILE}`) continue;
      if (dir === "" && item.name.endsWith(DOCUMENT_EXTENSION) && declaresDocument(fields, documentPath(item.name))) continue;
      changes.push({ type: "copy", from: `${from}${relative}`, path: `${to}${relative}` });
    }
  };
  await walk("");
}

/**
 * Files that a new entry uses from `<collection>/<other ID>/media/`:
 * uploads made before the ID was final. Each gets a free name in the
 * entry's own `media/` folder. From a folder where no entry lives they move;
 * from another entry's folder (a colleague saved that ID first) they are
 * copied, because that entry may use them too.
 */
export async function stagedUploads(
  files: ContentFiles,
  def: Collection,
  collection: string,
  data: Record<string, unknown>,
  base: string,
): Promise<Array<{ from: string; to: string; keep: boolean }>> {
  const moves: Array<{ from: string; to: string; keep: boolean }> = [];
  const taken = new Set((await files.list(`${base}/media`)).map((item) => item.name));
  for (const link of documentLinks(def.fields, data, base)) {
    if (link.kind !== "media") continue;
    const match = /^([^/]+)\/([^/]+)\/media\/([^/]+)$/.exec(link.path);
    if (!match || match[1] !== collection || `${collection}/${match[2]}` === base) continue;
    if (moves.some((move) => move.from === link.path)) continue;
    const keep = (await files.read(entryDataPath(collection, match[2]!))) !== null;
    if ((await files.stat(link.path)) === null) continue;
    const extension = match[3]!.includes(".") ? match[3]!.slice(match[3]!.lastIndexOf(".")) : "";
    const stem = match[3]!.slice(0, match[3]!.length - extension.length);
    let name = match[3]!;
    for (let n = 2; taken.has(name); n += 1) name = `${stem}-${n}${extension}`;
    taken.add(name);
    moves.push({ from: link.path, to: `${base}/media/${name}`, keep });
  }
  return moves;
}

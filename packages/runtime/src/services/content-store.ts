/**
 * Collections and singletons over the working tree's files: validation, slugs,
 * entry files and `_order.json`. An entry is its slug and path, Git keeps the
 * history, a save is a draft, and only Publish makes a commit.
 */

import { createHash } from "node:crypto";
import { posix } from "node:path";

import {
  ContentPathError,
  DOCUMENT_EXTENSION,
  INDEX_FILE,
  ORDER_FILE,
  collectionEntryPath,
  entryFiles,
  entryLayout,
  entryTitle,
  isValidSlug,
  collectReferences,
  readCollection,
  mapMedia,
  readCollectionEntry,
  readSingleton,
  relativizeMedia,
  relinkReferences,
  resolveSlugField,
  resolveTitleField,
  serializeEntry,
  singletonPath,
  slugify,
  uniqueSlug,
  validateFields,
  withDefaults,
  type Collection,
  type ContentEntry,
  type FieldIssue,
  type FieldMap,
  type Singleton,
  type Site,
} from "@micacms/core";

import { ConflictError, FilesError, type ContentFiles, type FileChange } from "../workspace/files.js";

export class ContentError extends FilesError {
  override name = "ContentError";
}

/** A write to a collection or singleton that this build of Mica cannot interpret. */
export class ReadOnlyError extends ContentError {
  override name = "ReadOnlyError";
}

export class ValidationError extends ContentError {
  override name = "ValidationError";
  constructor(
    message: string,
    readonly issues: FieldIssue[],
  ) {
    super(message);
  }
}

export interface SaveEntryInput {
  data: Record<string, unknown>;
  /** The entry being replaced. Absent when creating. */
  slug?: string;
  /** The revision `slug` had when the editor opened it. Absent writes unconditionally. */
  expectedRevision?: string | null;
  /** On a URL change: point the relations in other entries and settings at the new URL, in the same write. */
  updateLinks?: boolean;
}

/** An entry or settings page that links to an entry. `readOnly`: this build cannot change its links. */
export type Referrer =
  | { kind: "entry"; collection: string; slug: string; title: string; readOnly?: true }
  | { kind: "singleton"; name: string; title: string; readOnly?: true };

export interface SavedEntry {
  slug: string;
  title: string;
  /** The entry's revision after this save, for the next save. A file revision, not a commit. */
  revision: string;
  /** True when the save moved the entry's files. */
  renamed: boolean;
  /** How many other entries and settings pages now link to the new URL. */
  relinked: number;
}

/** `readOnly` comes from `readOnlyParts`: its collections and singletons are read, never written. */
export function createContentStore(site: Site, workspace: ContentFiles, readOnly: ReadonlyMap<string, string> = new Map()) {
  const requireCollection = (name: string): Collection => {
    const def = site.collections[name];
    if (!def) throw new ContentError(`Unknown collection "${name}".`);
    return def;
  };

  const requireSingleton = (name: string): Singleton => {
    const def = site.singletons[name];
    if (!def) throw new ContentError(`Unknown singleton "${name}".`);
    return def;
  };

  const writable = <T>(def: T, key: string): T => {
    const reason = readOnly.get(key);
    if (reason) throw new ReadOnlyError(reason);
    return def;
  };

  const validate = (
    def: Collection | Singleton,
    data: unknown,
    what: string,
  ): Record<string, unknown> => {
    // Save keeps a half-finished entry; Publish checks `required` (decision "Publish a selection").
    const result = validateFields(def.fields, data, { enforceRequired: false });
    if (!result.ok) {
      throw new ValidationError(
        `${what} cannot be saved until these fields are correct.`,
        result.issues,
      );
    }
    return result.data as Record<string, unknown>;
  };

  /**
   * Deletes for `.mdoc` files not in `keep`, so a cleared rich-text field does
   * not come back on the next read. Media stays: an unreferenced upload is not
   * garbage.
   */
  const staleDocuments = async (base: string, keep: Set<string>): Promise<FileChange[]> => {
    const changes: FileChange[] = [];

    for (const item of await workspace.list(base)) {
      if (item.type !== "file") continue;
      if (!item.name.endsWith(DOCUMENT_EXTENSION)) continue;
      if (keep.has(item.name)) continue;
      changes.push({ type: "delete", path: `${base}/${item.name}` });
    }

    return changes;
  };

  /**
   * The document's revision after a write. Throws when the file is absent,
   * because an empty token could never match.
   */
  const revisionAfterWrite = async (dataFile: string, folder: string | null): Promise<string> => {
    const revision = await documentRevision(dataFile, folder);
    if (revision === null) {
      throw new ContentError(`Saved, but "${dataFile}" is not in the repository afterwards.`);
    }
    return revision;
  };

  /** The folder whose files make up one document, or null for a one-file document. */
  const folderOf = (fields: FieldMap, base: string): string | null =>
    entryLayout(fields) === "directory" ? base : null;

  /**
   * The revision of a whole document: its data file and, in the folder layout,
   * every file of its folder. A change to any one of them makes the next save a
   * conflict, not an overwrite.
   */
  const documentRevision = async (dataFile: string, folder: string | null): Promise<string | null> => {
    const files = await documentFiles(dataFile, folder);
    if (files === null) return null;
    if (folder === null) return files.get(dataFile)!;
    const parts = [...files].map(([path, revision]) => `${path}\u0000${revision}`);
    return createHash("sha256").update(parts.sort().join("\n")).digest("hex").slice(0, 16);
  };

  /** Every file of a document with its revision, or null when its data file is absent. */
  const documentFiles = async (dataFile: string, folder: string | null): Promise<Map<string, string> | null> => {
    const data = await workspace.revision(dataFile);
    if (data === null) return null;
    const files = new Map([[dataFile, data]]);
    if (folder === null) return files;
    const walk = async (dir: string): Promise<void> => {
      for (const item of await workspace.list(dir)) {
        const child = `${dir}/${item.name}`;
        if (item.type === "directory") await walk(child);
        else files.set(child, (await workspace.revision(child)) ?? "");
      }
    };
    await walk(folder);
    return files;
  };

  /**
   * Refuses when the document changed since the editor read `expected`, and
   * returns every file's revision for `apply`, which checks them all again
   * under the write lock.
   */
  const expectDocument = async (
    expected: string | null | undefined,
    dataFile: string,
    folder: string | null,
  ): Promise<Record<string, string | null> | undefined> => {
    if (expected === undefined) return undefined;
    const files = await documentFiles(dataFile, folder);
    if ((await documentRevision(dataFile, folder)) !== expected) {
      throw new ConflictError("This content changed after you opened it. Reload to see the current version.", [
        dataFile,
      ]);
    }
    return files === null ? { [dataFile]: null } : Object.fromEntries(files);
  };

  /**
   * The order file with a renamed slug in its old place, so the entry does not
   * drop to the end of the list.
   */
  const renameInOrder = async (name: string, from: string, to: string): Promise<FileChange | null> => {
    const path = `${name}/${ORDER_FILE}`;
    const raw = await workspace.read(path);
    if (raw === null) return null;

    let listed: unknown;
    try {
      listed = JSON.parse(raw);
    } catch {
      // Reading the collection reports a malformed order file; a save need not.
      return null;
    }
    if (!Array.isArray(listed) || !listed.includes(from)) return null;

    const order = listed.map((slug: unknown) => (slug === from ? to : slug));
    return { type: "write", path, contents: `${JSON.stringify(order, null, 2)}\n` };
  };

  /** Entries and settings pages whose relations point at `collection`/`slug`, with what a relink needs. */
  const referrers = async (collection: string, slug: string) => {
    const found: Array<{
      referrer: Referrer;
      fields: FieldMap;
      base: string;
      dataFile: string;
      /** Reads the data again, so that a relink starts from what is on disk now. */
      read: () => Promise<Record<string, unknown> | null>;
    }> = [];
    const readOnlyMark = (key: string) => (readOnly.has(key) ? { readOnly: true as const } : {});
    const points = (fields: FieldMap, data: Record<string, unknown>) =>
      collectReferences(fields, data).some(
        (reference) => reference.kind === "relation" && reference.collection === collection && reference.slug === slug,
      );

    for (const [name, def] of Object.entries(site.collections)) {
      if (!linksTo(def.fields, collection)) continue;
      for (const entry of await readCollection(workspace, def, name)) {
        if (!points(def.fields, entry.data)) continue;
        found.push({
          referrer: {
            kind: "entry",
            collection: name,
            slug: entry.slug,
            title: entryTitle(def, entry.data),
            ...readOnlyMark(`collections.${name}`),
          },
          fields: def.fields,
          base: collectionEntryPath(def.fields, name, entry.slug),
          dataFile: dataPath(def, name, entry.slug),
          read: () => readCollectionEntry(workspace, def, name, entry.slug),
        });
      }
    }
    for (const [name, def] of Object.entries(site.singletons)) {
      if (!linksTo(def.fields, collection)) continue;
      const data = await readSingleton(workspace, def, name);
      if (!data || !points(def.fields, data)) continue;
      found.push({
        referrer: { kind: "singleton", name, title: def.label, ...readOnlyMark(`singletons.${name}`) },
        fields: def.fields,
        base: singletonPath(def.fields, name),
        dataFile: singletonDataPath(def, name),
        read: () => readSingleton(workspace, def, name),
      });
    }
    return found;
  };

  /**
   * Files that a new entry uses from `<collection>/<other slug>/media/`:
   * uploads made before the URL was final. Each gets a free name in the
   * entry's own `media/` folder. From a folder where no entry lives they move;
   * from another entry's folder (a colleague saved that URL first) they are
   * copied, because that entry may use them too.
   */
  const stagedUploads = async (def: Collection, collection: string, data: Record<string, unknown>, base: string) => {
    const moves: Array<{ from: string; to: string; bytes: Uint8Array; keep: boolean }> = [];
    const taken = new Set((await workspace.list(`${base}/media`)).map((item) => item.name));
    for (const reference of collectReferences(def.fields, data)) {
      if (reference.kind !== "media") continue;
      const match = /^([^/]+)\/([^/]+)\/media\/([^/]+)$/.exec(reference.path);
      if (!match || match[1] !== collection || `${collection}/${match[2]}` === base) continue;
      if (moves.some((move) => move.from === reference.path)) continue;
      const keep = (await workspace.read(dataPath(def, collection, match[2]!))) !== null;
      const bytes = await workspace.readBinary(reference.path);
      if (bytes === null) continue;
      const extension = match[3]!.includes(".") ? match[3]!.slice(match[3]!.lastIndexOf(".")) : "";
      const stem = match[3]!.slice(0, match[3]!.length - extension.length);
      let name = match[3]!;
      for (let n = 2; taken.has(name); n += 1) name = `${stem}-${n}${extension}`;
      taken.add(name);
      moves.push({ from: reference.path, to: `${base}/media/${name}`, bytes, keep });
    }
    return moves;
  };

  /** Slugs already taken in a collection, so a new one can be made unique. */
  const takenSlugs = async (def: Collection, name: string, except?: string): Promise<string[]> => {
    const entries = await readCollection(workspace, def, name);
    return entries.map((entry) => entry.slug).filter((slug) => slug !== except);
  };

  return {
    async list(collectionName: string): Promise<ContentEntry[]> {
      return readCollection(workspace, requireCollection(collectionName), collectionName);
    },

    async get(collectionName: string, slug: string): Promise<ContentEntry | null> {
      const entries = await this.list(collectionName);
      return entries.find((entry) => entry.slug === slug) ?? null;
    },

    /** The revision an editor must send back with a save of this entry. */
    async revisionOf(collectionName: string, slug: string): Promise<string | null> {
      const def = requireCollection(collectionName);
      return documentRevision(
        dataPath(def, collectionName, slug),
        folderOf(def.fields, collectionEntryPath(def.fields, collectionName, slug)),
      );
    },

    /** The revision an editor must send back with a save of this singleton. */
    async revisionOfSingleton(name: string): Promise<string | null> {
      const def = requireSingleton(name);
      return documentRevision(singletonDataPath(def, name), folderOf(def.fields, singletonPath(def.fields, name)));
    },

    async getSingleton(name: string): Promise<Record<string, unknown>> {
      const def = requireSingleton(name);
      const data = await readSingleton(workspace, def, name);
      // A singleton with no file yet opens as an empty form, not a 404.
      return withDefaults(def.fields, data);
    },

    async save(collectionName: string, input: SaveEntryInput): Promise<SavedEntry> {
      const def = writable(requireCollection(collectionName), `collections.${collectionName}`);
      const data = validate(def, input.data, "This entry");

      const slugKey = resolveSlugField(def)!;
      const requested = pickSlug(def, data, input.slug);
      const slug =
        requested === input.slug
          ? requested
          : uniqueSlug(requested, await takenSlugs(def, collectionName, input.slug));

      data[slugKey] = slug;
      const base = collectionEntryPath(def.fields, collectionName, slug);
      // A new entry's uploads went into the folder of the URL it had then.
      const staged = input.slug === undefined ? await stagedUploads(def, collectionName, data, base) : [];
      if (staged.length > 0) {
        const moved = new Map(staged.map((item) => [item.from, item.to]));
        Object.assign(data, mapMedia(def.fields, data, (value) => (typeof value === "string" ? (moved.get(value) ?? value) : value)));
      }
      // An entry that links to itself follows its own new URL.
      const own = previousLinks(input, slug) ? relinkReferences(def.fields, data, collectionName, input.slug!, slug) : null;
      if (own) Object.assign(data, own);

      const previousBase =
        input.slug && input.slug !== slug
          ? collectionEntryPath(def.fields, collectionName, input.slug)
          : null;

      // The editor uses root-relative media paths; store them relative to the
      // entry (the old directory on a rename).
      const serialized = serializeEntry(
        def.fields,
        mediaForDisk(def.fields, data, previousBase ?? base),
      );
      const files = entryFiles(def.fields, base, serialized);

      const changes: FileChange[] = Object.entries(files).map(([path, contents]) => ({
        type: "write",
        path,
        contents,
      }));
      for (const item of staged) {
        changes.push({ type: "write", path: item.to, contents: item.bytes });
        if (!item.keep) changes.push({ type: "delete", path: item.from });
      }

      if (previousBase) {
        changes.push(
          entryLayout(def.fields) === "directory"
            ? { type: "deleteTree", path: previousBase }
            : { type: "delete", path: previousBase },
        );
        await moveMedia(workspace, previousBase, base, changes);
        const order = await renameInOrder(collectionName, input.slug!, slug);
        if (order) changes.push(order);
      } else if (entryLayout(def.fields) === "directory") {
        changes.push(...(await staleDocuments(base, new Set(Object.keys(serialized.documents)))));
      }

      // Only the data file of each referrer changes; its rich text and media stay as they are.
      // A read-only part is left alone: this build may not write it.
      let relinked = 0;
      const referrerRevisions: Record<string, string | null> = {};
      if (previousLinks(input, slug)) {
        for (const found of await referrers(collectionName, input.slug!)) {
          if (found.referrer.readOnly) continue;
          if (found.referrer.kind === "entry" && found.referrer.collection === collectionName && found.referrer.slug === input.slug) continue;
          // The revision before the read: a save in between makes the write refuse, not overwrite it.
          const revision = await workspace.revision(found.dataFile);
          const current = await found.read();
          const next = current && relinkReferences(found.fields, current, collectionName, input.slug!, slug);
          if (!next) continue;
          const written = entryFiles(found.fields, found.base, serializeEntry(found.fields, mediaForDisk(found.fields, next, found.base)));
          changes.push({ type: "write", path: found.dataFile, contents: written[found.dataFile]! });
          referrerRevisions[found.dataFile] = revision;
          relinked += 1;
        }
      }

      const title = entryTitle(def, data);
      const expected = await expectDocument(
        input.expectedRevision,
        dataPath(def, collectionName, input.slug ?? slug),
        folderOf(def.fields, previousBase ?? base),
      );
      try {
        await workspace.apply({
          changes,
          expect: relinked > 0 ? { ...expected, ...referrerRevisions } : expected,
        });
      } catch (error) {
        if (error instanceof ConflictError && error.paths.some((path) => path in referrerRevisions)) {
          throw new ConflictError("An entry or page that links here changed while you saved. Save again.", error.paths);
        }
        throw error;
      }

      const revision = await revisionAfterWrite(dataPath(def, collectionName, slug), folderOf(def.fields, base));

      return { slug, title, revision, renamed: previousBase !== null, relinked };
    },

    async remove(
      collectionName: string,
      slug: string,
      options: { expectedRevision?: string | null } = {},
    ): Promise<void> {
      const def = writable(requireCollection(collectionName), `collections.${collectionName}`);
      // One path segment: an empty slug or `a/b` would delete more than one entry.
      if (slug === "" || slug.includes("/") || slug === "." || slug === "..") {
        throw new ContentPathError(`"${slug}" is not an entry of "${collectionName}".`);
      }
      const base = collectionEntryPath(def.fields, collectionName, slug);

      await workspace.apply({
        changes: [
          entryLayout(def.fields) === "directory"
            ? { type: "deleteTree", path: base }
            : { type: "delete", path: base },
        ],
        expect: await expectDocument(
          options.expectedRevision,
          dataPath(def, collectionName, slug),
          folderOf(def.fields, base),
        ),
      });
    },

    async saveSingleton(
      name: string,
      payload: unknown,
      options: { expectedRevision?: string | null } = {},
    ): Promise<{ revision: string }> {
      const def = writable(requireSingleton(name), `singletons.${name}`);
      const data = validate(def, payload, `The "${def.label}" settings`);

      const base = singletonPath(def.fields, name);
      const serialized = serializeEntry(def.fields, mediaForDisk(def.fields, data, base));

      const changes: FileChange[] = Object.entries(entryFiles(def.fields, base, serialized)).map(
        ([path, contents]) => ({ type: "write", path, contents }),
      );

      if (entryLayout(def.fields) === "directory") {
        changes.push(...(await staleDocuments(base, new Set(Object.keys(serialized.documents)))));
      }

      await workspace.apply({
        changes,
        expect: await expectDocument(options.expectedRevision, singletonDataPath(def, name), folderOf(def.fields, base)),
      });

      return { revision: await revisionAfterWrite(singletonDataPath(def, name), folderOf(def.fields, base)) };
    },

    async reorder(
      collectionName: string,
      slugs: string[],
    ): Promise<void> {
      const def = writable(requireCollection(collectionName), `collections.${collectionName}`);
      if (!def.sortable) {
        throw new ContentError(`The "${def.label}" collection is not manually sortable.`);
      }

      await workspace.apply({
        changes: [
          {
            type: "write",
            path: `${collectionName}/${ORDER_FILE}`,
            contents: `${JSON.stringify(slugs, null, 2)}\n`,
          },
        ],
      });
    },

    requireCollection,
    requireSingleton,

    /** Slug the server would assign, so the editor's URL preview matches it. */
    async suggestSlug(collectionName: string, source: string, except?: string): Promise<string> {
      const def = requireCollection(collectionName);
      return uniqueSlug(slugify(source), await takenSlugs(def, collectionName, except));
    },

    /**
     * Where each file is used: in a media field, or as an image or a link in rich
     * text. A file that something uses is not deleted.
     */
    async mediaUses(paths: string[]): Promise<{ uses: Record<string, Referrer[]>; unreadable: string[] }> {
      const wanted = new Set(paths);
      /** Collections and settings that could not be read: a use there cannot be ruled out. */
      const unreadable: string[] = [];
      const uses: Record<string, Referrer[]> = Object.fromEntries(paths.map((path) => [path, []]));
      const check = (referrer: Referrer, fields: FieldMap, data: Record<string, unknown>, folder: string) => {
        const found = new Set<string>();
        for (const reference of collectReferences(fields, data)) {
          if (reference.kind === "media" && wanted.has(reference.path)) found.add(reference.path);
        }
        for (const text of richTextValues(fields, data)) {
          for (const target of markdocTargets(text)) {
            const path = resolveTarget(target, folder);
            if (path && wanted.has(path)) found.add(path);
          }
        }
        for (const path of found) uses[path]!.push(referrer);
      };

      for (const [name, def] of Object.entries(site.collections)) {
        const entries = await readCollection(workspace, def, name).catch(() => null);
        if (!entries) {
          unreadable.push(def.label);
          continue;
        }
        for (const entry of entries) {
          const base = collectionEntryPath(def.fields, name, entry.slug);
          const folder = entryLayout(def.fields) === "directory" ? base : name;
          check({ kind: "entry", collection: name, slug: entry.slug, title: entryTitle(def, entry.data) }, def.fields, entry.data, folder);
        }
      }
      for (const [name, def] of Object.entries(site.singletons)) {
        const data = await readSingleton(workspace, def, name).catch(() => undefined);
        if (data === undefined) unreadable.push(def.label);
        if (!data) continue;
        const folder = entryLayout(def.fields) === "directory" ? singletonPath(def.fields, name) : "";
        check({ kind: "singleton", name, title: def.label }, def.fields, data, folder);
      }
      return { uses, unreadable };
    },

    /** Entries and settings pages that link to `slug`: the warning before a delete or a URL change. */
    async findReferences(collectionName: string, slug: string): Promise<Referrer[]> {
      requireCollection(collectionName);
      return (await referrers(collectionName, slug)).map((found) => found.referrer);
    },
  };
}

export type ContentStore = ReturnType<typeof createContentStore>;

/** Whether a save is a URL change whose links should follow. */
function previousLinks(input: SaveEntryInput, slug: string): boolean {
  return input.updateLinks === true && input.slug !== undefined && input.slug !== slug;
}

/** Every rich-text value in a payload, nested fields included. */
function richTextValues(fields: FieldMap, data: Record<string, unknown>): string[] {
  const found: string[] = [];
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const visit = (map: FieldMap, record: Record<string, unknown>) => {
    for (const [key, field] of Object.entries(map)) {
      const value = record[key];
      if (field.kind === "richText" && typeof value === "string") found.push(value);
      else if (field.kind === "object" && isRecord(value)) visit(field.fields, value);
      else if (field.kind === "repeater" && Array.isArray(value)) for (const row of value) if (isRecord(row)) visit(field.fields, row);
    }
  };
  visit(fields, data);
  return found;
}

/**
 * The targets of the images and links in Markdoc: `![alt](media/x.jpg)`,
 * `[Price list](/media/prices.pdf)`, a reference `[x]: media/x.jpg`, and a tag
 * attribute such as `{% figure src="media/x.jpg" %}`.
 */
function markdocTargets(text: string): string[] {
  const inline = [...text.matchAll(/\]\(\s*<?([^)\s>]+)/g)].map((match) => match[1]!);
  const references = [...text.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)/gm)].map((match) => match[1]!);
  const attributes = [...text.matchAll(/\{%[^%]*%\}/g)].flatMap((tag) =>
    [...tag[0].matchAll(/\b[\w-]+\s*=\s*"([^"]+)"/g)].map((match) => match[1]!),
  );
  return [...inline, ...references, ...attributes];
}

/** A rich-text target as a content path: from the content root with `/`, else from the document's folder. */
function resolveTarget(target: string, folder: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return null;
  let decoded: string;
  try {
    decoded = decodeURI(target.split(/[?#]/)[0]!);
  } catch {
    return null;
  }
  const joined = decoded.startsWith("/") ? decoded.slice(1) : folder === "" ? decoded : `${folder}/${decoded}`;
  const normal = posix.normalize(joined);
  return normal.startsWith("..") ? null : normal;
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
 * Media paths as the repository stores them. Only a directory entry has
 * colocated media to relativize.
 */
function mediaForDisk(
  fields: FieldMap,
  data: Record<string, unknown>,
  base: string,
): Record<string, unknown> {
  return entryLayout(fields) === "directory" ? relativizeMedia(fields, data, base) : data;
}

function dataPath(def: Collection, collection: string, slug: string): string {
  const base = collectionEntryPath(def.fields, collection, slug);
  return entryLayout(def.fields) === "directory" ? `${base}/${INDEX_FILE}` : base;
}

function singletonDataPath(def: Singleton, name: string): string {
  const base = singletonPath(def.fields, name);
  return entryLayout(def.fields) === "directory" ? `${base}/${INDEX_FILE}` : base;
}

/** The slug from the payload's slug field, or one derived from the title. */
function pickSlug(
  def: Collection,
  data: Record<string, unknown>,
  current: string | undefined,
): string {
  const slugKey = resolveSlugField(def)!;
  const fromData = data[slugKey];

  // Not `entryTitle`, whose "Untitled" would give every entry without a title the same URL.
  const titleKey = resolveTitleField(def);
  const title = titleKey ? data[titleKey] : undefined;
  const candidate =
    (typeof fromData === "string" && fromData.trim()) || (typeof title === "string" ? slugify(title.trim()) : "");

  if (!candidate) {
    throw new ContentError("An entry needs a title or a URL before it can be saved.");
  }

  const normalised = isValidSlug(candidate) ? candidate : slugify(candidate);
  if (!normalised) {
    throw new ContentError(`"${candidate}" cannot be turned into a URL. Use letters and numbers.`);
  }

  return normalised === current ? current : normalised;
}

/** Copies colocated media to the renamed entry; the caller deletes the old directory. */
async function moveMedia(
  files: ContentFiles,
  from: string,
  to: string,
  changes: FileChange[],
): Promise<void> {
  for (const item of await files.list(`${from}/media`)) {
    if (item.type !== "file") continue;

    const bytes = await files.readBinary(`${from}/media/${item.name}`);
    if (bytes === null) continue;

    changes.push({ type: "write", path: `${to}/media/${item.name}`, contents: bytes });
  }
}

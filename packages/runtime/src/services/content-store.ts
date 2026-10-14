/**
 * Collections and singletons over the working tree's files: validation, slugs,
 * entry files and `_order.json`. An entry is its slug and path, Git keeps the
 * history, a save is a draft, and only Publish makes a commit.
 */

import { createHash } from "node:crypto";

import {
  type Collection,
  collectionSlugs,
  collectReferences,
  type ContentEntry,
  ContentPathError,
  declaresDocument,
  defaultValues,
  DOCUMENT_EXTENSION,
  documentPath,
  entryDataPath,
  entryFiles,
  entryFolder,
  entryTitle,
  type FieldIssue,
  type FieldMap,
  INDEX_FILE,
  isValidSlug,
  mapMedia,
  markdocTargets,
  ORDER_FILE,
  readCollection,
  readCollectionEntry,
  readSingleton,
  relativizeMedia,
  relinkReferences,
  resolveMarkdocTarget,
  resolveSlugField,
  resolveTitleField,
  richTextValues,
  serializeEntry,
  type Singleton,
  type Site,
  slugify,
  validateFields,
} from "@micacms/core/internal";

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
    // `hasOwn`: a name such as `constructor` is not a collection.
    const def = Object.hasOwn(site.collections, name) ? site.collections[name] : undefined;
    if (!def) throw new ContentError(`Unknown collection "${name}".`);
    return def;
  };

  const requireSingleton = (name: string): Singleton => {
    const def = Object.hasOwn(site.singletons, name) ? site.singletons[name] : undefined;
    if (!def) throw new ContentError(`Unknown singleton "${name}".`);
    return def;
  };

  /** An existing entry's URL: one folder name. `a%2Fb` from a route parameter would name two. */
  const existingSlug = (collectionName: string, slug: string): string => {
    if (!isValidSlug(slug)) throw new ContentPathError(`"${slug}" is not an entry of "${collectionName}".`);
    return slug;
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
   * Deletes for the `.mdoc` files that the model declares and the save does not
   * write, so a cleared rich-text field does not come back on the next read. A
   * file that the model does not declare stays (#217). Media stays: an
   * unreferenced upload is not garbage.
   */
  const staleDocuments = async (fields: FieldMap, base: string, keep: Set<string>): Promise<FileChange[]> => {
    const changes: FileChange[] = [];

    for (const item of await workspace.list(base)) {
      if (item.type !== "file" || !item.name.endsWith(DOCUMENT_EXTENSION) || keep.has(item.name)) continue;
      if (!declaresDocument(fields, documentPath(item.name))) continue;
      changes.push({ type: "delete", path: `${base}/${item.name}` });
    }

    return changes;
  };

  /** The entry's `index.json` as it is now, whose undeclared keys a save keeps; empty without one. */
  const storedData = async (folder: string): Promise<Record<string, unknown>> => {
    try {
      const value: unknown = JSON.parse((await workspace.read(`${folder}/${INDEX_FILE}`)) ?? "{}");
      return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
      // Not JSON: the save replaces it, as before.
      return {};
    }
  };

  /**
   * The entry's revision after a write. Throws when the entry is absent,
   * because an empty token could never match.
   */
  const revisionAfterWrite = async (folder: string, files: ContentFiles): Promise<string> => {
    const revision = await documentRevision(folder, files);
    if (revision === null) {
      throw new ContentError(`Saved, but "${folder}/${INDEX_FILE}" is not in the repository afterwards.`);
    }
    return revision;
  };

  /**
   * The revision of a whole entry: every file of its folder. A change to any
   * one of them makes the next save a conflict, not an overwrite.
   */
  const documentRevision = async (folder: string, files: ContentFiles = workspace): Promise<string | null> =>
    hashFiles(await documentFiles(folder, files));

  const hashFiles = (files: Map<string, string> | null): string | null => {
    if (files === null) return null;
    const parts = [...files].map(([path, revision]) => `${path}\u0000${revision}`);
    return createHash("sha256").update(parts.sort().join("\n")).digest("hex").slice(0, 16);
  };

  /** Every file of an entry's folder with its revision, or null when it has no data file. */
  const documentFiles = async (folder: string, source: ContentFiles = workspace): Promise<Map<string, string> | null> => {
    const dataFile = `${folder}/${INDEX_FILE}`;
    const data = await source.revision(dataFile);
    if (data === null) return null;
    const found = new Map([[dataFile, data]]);
    const walk = async (dir: string): Promise<void> => {
      for (const item of await source.list(dir)) {
        const child = `${dir}/${item.name}`;
        if (item.type === "directory") await walk(child);
        else found.set(child, (await source.revision(child)) ?? "");
      }
    };
    await walk(folder);
    return found;
  };

  /**
   * Refuses when the entry changed since the editor read `expected`, and
   * returns every file's revision for `apply`, which checks them all again
   * under the write lock.
   */
  const expectDocument = async (
    expected: string | null | undefined,
    folder: string,
  ): Promise<Record<string, string | null> | undefined> => {
    if (expected === undefined) return undefined;
    const dataFile = `${folder}/${INDEX_FILE}`;
    const files = await documentFiles(folder);
    if (hashFiles(files) !== expected) {
      throw new ConflictError("This content changed after you opened it. Reload to see the current version.", [dataFile]);
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
      folder: string;
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
          folder: entryFolder(name, entry.slug),
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
        folder: entryFolder(name),
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
    const moves: Array<{ from: string; to: string; keep: boolean }> = [];
    const taken = new Set((await workspace.list(`${base}/media`)).map((item) => item.name));
    for (const reference of collectReferences(def.fields, data)) {
      if (reference.kind !== "media") continue;
      const match = /^([^/]+)\/([^/]+)\/media\/([^/]+)$/.exec(reference.path);
      if (!match || match[1] !== collection || `${collection}/${match[2]}` === base) continue;
      if (moves.some((move) => move.from === reference.path)) continue;
      const keep = (await workspace.read(entryDataPath(collection, match[2]!))) !== null;
      if ((await workspace.stat(reference.path)) === null) continue;
      const extension = match[3]!.includes(".") ? match[3]!.slice(match[3]!.lastIndexOf(".")) : "";
      const stem = match[3]!.slice(0, match[3]!.length - extension.length);
      let name = match[3]!;
      for (let n = 2; taken.has(name); n += 1) name = `${stem}-${n}${extension}`;
      taken.add(name);
      moves.push({ from: reference.path, to: `${base}/media/${name}`, keep });
    }
    return moves;
  };

  /** Whether an entry has this URL: its data file exists. A folder with only uploads is not one. */
  const entryExists = async (name: string, slug: string): Promise<boolean> =>
    (await workspace.stat(entryDataPath(name, slug))) !== null;

  /** The first free URL from `base` (`base`, `base-2`, …), checking candidates rather than reading the collection. */
  const freeSlug = async (name: string, base: string, except?: string): Promise<string> => {
    for (let suffix = 1; ; suffix++) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;
      if (candidate === except || !(await entryExists(name, candidate))) return candidate;
    }
  };

  return {
    async list(collectionName: string): Promise<ContentEntry[]> {
      return readCollection(workspace, requireCollection(collectionName), collectionName);
    },

    /** How many entries a collection has, from one directory listing: for counts, not for lists. */
    async count(collectionName: string): Promise<number> {
      requireCollection(collectionName);
      const names = await collectionSlugs(workspace, collectionName);
      const exists = await Promise.all(names.map((slug) => entryExists(collectionName, slug)));
      return exists.filter(Boolean).length;
    },

    /** One entry, without opening the rest of its collection. */
    async get(collectionName: string, slug: string): Promise<Omit<ContentEntry, "position"> | null> {
      const def = requireCollection(collectionName);
      // A file system that ignores case would otherwise open `News-42` as `news-42`.
      if (!isValidSlug(slug)) return null;
      const data = await readCollectionEntry(workspace, def, collectionName, slug);
      return data ? { slug, data } : null;
    },

    /** The revision an editor must send back with a save of this entry. */
    async revisionOf(collectionName: string, slug: string): Promise<string | null> {
      requireCollection(collectionName);
      return documentRevision(entryFolder(collectionName, slug));
    },

    /** The revision an editor must send back with a save of this singleton. */
    async revisionOfSingleton(name: string): Promise<string | null> {
      requireSingleton(name);
      return documentRevision(entryFolder(name));
    },

    async getSingleton(name: string): Promise<Record<string, unknown>> {
      const def = requireSingleton(name);
      const data = await readSingleton(workspace, def, name);
      // A singleton with no file yet opens as a new one: an empty form with its defaults, not a 404.
      return data ?? defaultValues(def.fields);
    },

    async save(collectionName: string, input: SaveEntryInput): Promise<SavedEntry> {
      const def = writable(requireCollection(collectionName), `collections.${collectionName}`);
      if (input.slug !== undefined) existingSlug(collectionName, input.slug);
      const data = validate(def, input.data, "This entry");

      const slugKey = resolveSlugField(def)!;
      const requested = pickSlug(def, data, input.slug);
      const slug =
        requested === input.slug
          ? requested
          : await freeSlug(collectionName, requested, input.slug);

      data[slugKey] = slug;
      const base = entryFolder(collectionName, slug);
      // A new entry's uploads went into the folder of the URL it had then.
      const staged = input.slug === undefined ? await stagedUploads(def, collectionName, data, base) : [];
      if (staged.length > 0) {
        const moved = new Map(staged.map((item) => [item.from, item.to]));
        Object.assign(data, mapMedia(def.fields, data, (value) => (typeof value === "string" ? (moved.get(value) ?? value) : value)));
      }
      // An entry that links to itself follows its own new URL.
      const own = previousLinks(input, slug) ? relinkReferences(def.fields, data, collectionName, input.slug!, slug) : null;
      if (own) Object.assign(data, own);

      const previousBase = input.slug && input.slug !== slug ? entryFolder(collectionName, input.slug) : null;

      // The editor uses root-relative media paths; store them relative to the
      // entry (the old directory on a rename).
      const serialized = serializeEntry(
        def.fields,
        relativizeMedia(def.fields, data, previousBase ?? base),
        await storedData(previousBase ?? base),
      );
      const files = entryFiles(base, serialized);

      const changes: FileChange[] = Object.entries(files).map(([path, contents]) => ({
        type: "write",
        path,
        contents,
      }));
      for (const item of staged) {
        changes.push({ type: "copy", from: item.from, path: item.to });
        if (!item.keep) changes.push({ type: "delete", path: item.from });
      }

      if (previousBase) {
        // The copies first: they read from the old folder.
        await moveFiles(workspace, def.fields, previousBase, base, changes);
        changes.push({ type: "deleteTree", path: previousBase });
        const order = await renameInOrder(collectionName, input.slug!, slug);
        if (order) changes.push(order);
      } else {
        changes.push(...(await staleDocuments(def.fields, base, new Set(Object.keys(serialized.documents)))));
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
          const dataFile = `${found.folder}/${INDEX_FILE}`;
          const revision = await workspace.revision(dataFile);
          const current = await found.read();
          const next = current && relinkReferences(found.fields, current, collectionName, input.slug!, slug);
          if (!next) continue;
          const { data: contents } = serializeEntry(
            found.fields,
            relativizeMedia(found.fields, next, found.folder),
            await storedData(found.folder),
          );
          changes.push({ type: "write", path: dataFile, contents });
          referrerRevisions[dataFile] = revision;
          relinked += 1;
        }
      }

      const title = entryTitle(def, data);
      const expected = await expectDocument(input.expectedRevision, previousBase ?? base);
      let revision: string;
      try {
        revision = await workspace.apply(
          { changes, expect: relinked > 0 ? { ...expected, ...referrerRevisions } : expected },
          (files) => revisionAfterWrite(base, files),
        );
      } catch (error) {
        if (error instanceof ConflictError && error.paths.some((path) => path in referrerRevisions)) {
          throw new ConflictError("An entry or page that links here changed while you saved. Save again.", error.paths);
        }
        throw error;
      }

      return { slug, title, revision, renamed: previousBase !== null, relinked };
    },

    async remove(
      collectionName: string,
      slug: string,
      options: { expectedRevision?: string | null } = {},
    ): Promise<void> {
      writable(requireCollection(collectionName), `collections.${collectionName}`);
      // One path segment: an empty slug or `a/b` would delete more than one entry.
      existingSlug(collectionName, slug);
      const base = entryFolder(collectionName, slug);

      await workspace.apply({
        changes: [{ type: "deleteTree", path: base }],
        expect: await expectDocument(options.expectedRevision, base),
      });
    },

    async saveSingleton(
      name: string,
      payload: unknown,
      options: { expectedRevision?: string | null } = {},
    ): Promise<{ revision: string }> {
      const def = writable(requireSingleton(name), `singletons.${name}`);
      const data = validate(def, payload, `The "${def.label}" settings`);

      const base = entryFolder(name);
      const serialized = serializeEntry(def.fields, relativizeMedia(def.fields, data, base), await storedData(base));

      const changes: FileChange[] = Object.entries(entryFiles(base, serialized)).map(
        ([path, contents]) => ({ type: "write", path, contents }),
      );
      changes.push(...(await staleDocuments(def.fields, base, new Set(Object.keys(serialized.documents)))));

      const expect = await expectDocument(options.expectedRevision, base);
      return { revision: await workspace.apply({ changes, expect }, (files) => revisionAfterWrite(base, files)) };
    },

    /** The revision of a collection's order file, or null without one. */
    async orderRevision(collectionName: string): Promise<string | null> {
      requireCollection(collectionName);
      return workspace.revision(`${collectionName}/${ORDER_FILE}`);
    },

    /** Writes the order. `expectedRevision` is the order the editor saw: a colleague's move in between is a conflict. */
    async reorder(collectionName: string, slugs: string[], expectedRevision: string | null): Promise<string> {
      const def = writable(requireCollection(collectionName), `collections.${collectionName}`);
      if (!def.sortable) {
        throw new ContentError(`The "${def.label}" collection is not manually sortable.`);
      }

      const path = `${collectionName}/${ORDER_FILE}`;
      try {
        const written = await workspace.apply(
          {
            changes: [{ type: "write", path, contents: `${JSON.stringify(slugs, null, 2)}\n` }],
            expect: { [path]: expectedRevision },
          },
          (files) => files.revision(path),
        );
        return written!;
      } catch (error) {
        if (error instanceof ConflictError) {
          throw new ConflictError("Someone changed this order after you opened it. Reload to see the current order.", [path]);
        }
        throw error;
      }
    },

    requireCollection,
    requireSingleton,

    /** Slug the server would assign, so the editor's URL preview matches it. */
    async suggestSlug(collectionName: string, source: string, except?: string): Promise<string> {
      requireCollection(collectionName);
      return freeSlug(collectionName, slugify(source), except);
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
            const path = resolveMarkdocTarget(target, folder);
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
          check({ kind: "entry", collection: name, slug: entry.slug, title: entryTitle(def, entry.data) }, def.fields, entry.data, entryFolder(name, entry.slug));
        }
      }
      for (const [name, def] of Object.entries(site.singletons)) {
        const data = await readSingleton(workspace, def, name).catch(() => undefined);
        if (data === undefined) unreadable.push(def.label);
        if (!data) continue;
        check({ kind: "singleton", name, title: def.label }, def.fields, data, entryFolder(name));
      }
      return { uses, unreadable };
    },

    /** Entries and settings pages that link to `slug`: the warning before a delete or a URL change. */
    async findReferences(collectionName: string, slug: string): Promise<Referrer[]> {
      requireCollection(collectionName);
      existingSlug(collectionName, slug);
      return (await referrers(collectionName, slug)).map((found) => found.referrer);
    },
  };
}

export type ContentStore = ReturnType<typeof createContentStore>;

/** Whether a save is a URL change whose links should follow. */
function previousLinks(input: SaveEntryInput, slug: string): boolean {
  return input.updateLinks === true && input.slug !== undefined && input.slug !== slug;
}

/** Whether a field map has a relation to `collection`, nested fields included. */
function linksTo(fields: FieldMap, collection: string): boolean {
  return Object.values(fields).some(
    (field) =>
      (field.kind === "relation" && field.collection === collection) ||
      ((field.kind === "object" || field.kind === "repeater") && linksTo(field.fields, collection)),
  );
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

/**
 * Copies the files of a renamed entry that the save does not write: its media,
 * and files that the model does not declare. The caller deletes the old folder.
 */
async function moveFiles(
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

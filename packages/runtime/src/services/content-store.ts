/**
 * Collections and singletons over the working tree's files: validation, slugs,
 * entry files and `_order.json`. An entry is its slug and path, Git keeps the
 * history, a save is a draft, and only Publish makes a commit.
 */

import { createHash } from "node:crypto";

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
  readSingleton,
  relativizeMedia,
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
}

export interface SavedEntry {
  slug: string;
  title: string;
  /** The entry's revision after this save, for the next save. A file revision, not a commit. */
  revision: string;
  /** True when the save moved the entry's files. */
  renamed: boolean;
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

      const title = entryTitle(def, data);
      await workspace.apply({
        changes,
        expect: await expectDocument(
          input.expectedRevision,
          dataPath(def, collectionName, input.slug ?? slug),
          folderOf(def.fields, previousBase ?? base),
        ),
      });

      const revision = await revisionAfterWrite(dataPath(def, collectionName, slug), folderOf(def.fields, base));

      return { slug, title, revision, renamed: previousBase !== null };
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

    /** Entries pointing at `slug`, so the editor can warn before a delete. */
    async findReferences(collectionName: string, slug: string) {
      const results: Array<{ collection: string; slug: string; title: string }> = [];

      for (const [name, def] of Object.entries(site.collections)) {
        if (!linksTo(def.fields, collectionName)) continue;
        for (const entry of await readCollection(workspace, def, name)) {
          const points = collectReferences(def.fields, entry.data).some(
            (reference) =>
              reference.kind === "relation" && reference.collection === collectionName && reference.slug === slug,
          );
          if (points) {
            results.push({ collection: name, slug: entry.slug, title: entryTitle(def, entry.data) });
          }
        }
      }

      return results;
    },
  };
}

export type ContentStore = ReturnType<typeof createContentStore>;

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

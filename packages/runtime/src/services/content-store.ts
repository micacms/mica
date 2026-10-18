/**
 * Collections and singletons over the working tree's files: validation, slugs,
 * entry files and `_order.json`. An entry is its slug and path, Git keeps the
 * history, a save is a draft, and only Publish makes a commit.
 */

import { createHash } from "node:crypto";

import {
  type Collection,
  collectionSlugs,
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
  ORDER_FILE,
  readCollection,
  readCollectionEntry,
  readSingleton,
  relativizeMedia,
  relinkReferences,
  resolveSlugField,
  resolveTitleField,
  serializeEntry,
  type Singleton,
  type Site,
  slugify,
  validateFields,
} from "@micacms/core/internal";

import { ConflictError, FilesError, type ContentFiles, type FileChange } from "../workspace/files.js";
import { fileUses, type Referrer } from "./links.js";
import { linkingDocuments, moveFiles, relinkedFiles, renameInOrder, stagedUploads, storedData } from "./url-change.js";

export class ContentError extends FilesError {
  override name = "ContentError";
}

/** A collection or singleton that the model does not have. */
export class UnknownContentError extends ContentError {
  override name = "UnknownContentError";
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

export type { Referrer } from "./links.js";

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
    if (!def) throw new UnknownContentError(`Unknown collection "${name}".`);
    return def;
  };

  const requireSingleton = (name: string): Singleton => {
    const def = Object.hasOwn(site.singletons, name) ? site.singletons[name] : undefined;
    if (!def) throw new UnknownContentError(`Unknown singleton "${name}".`);
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
      const staged = input.slug === undefined ? await stagedUploads(workspace, def, collectionName, data, base) : [];
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
        await storedData(workspace, previousBase ?? base),
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
        const order = await renameInOrder(workspace, collectionName, input.slug!, slug);
        if (order) changes.push(order);
      } else {
        changes.push(...(await staleDocuments(def.fields, base, new Set(Object.keys(serialized.documents)))));
      }

      // The other documents that link here follow too; the entry itself followed above.
      const referrerRevisions: Record<string, string | null> = {};
      if (previousLinks(input, slug)) {
        const linking = (await linkingDocuments(site, workspace, readOnly, collectionName, input.slug!)).filter(
          ({ referrer }) => !(referrer.kind === "entry" && referrer.collection === collectionName && referrer.slug === input.slug),
        );
        const relinks = await relinkedFiles(workspace, linking, collectionName, input.slug!, slug);
        changes.push(...relinks.changes);
        Object.assign(referrerRevisions, relinks.revisions);
      }
      const relinked = Object.keys(referrerRevisions).length;

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
      const serialized = serializeEntry(def.fields, relativizeMedia(def.fields, data, base), await storedData(workspace, base));

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
    mediaUses(paths: string[]): Promise<{ uses: Record<string, Referrer[]>; unreadable: string[] }> {
      return fileUses(site, workspace, paths);
    },

    /** Entries and settings pages that link to `slug`: the warning before a delete or a URL change. */
    async findReferences(collectionName: string, slug: string): Promise<Referrer[]> {
      requireCollection(collectionName);
      existingSlug(collectionName, slug);
      return (await linkingDocuments(site, workspace, readOnly, collectionName, slug)).map((found) => found.referrer);
    },
  };
}

export type ContentStore = ReturnType<typeof createContentStore>;

/** Whether a save is a URL change whose links should follow. */
function previousLinks(input: SaveEntryInput, slug: string): boolean {
  return input.updateLinks === true && input.slug !== undefined && input.slug !== slug;
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

/**
 * The content store: collections and singletons over a repository connector.
 *
 * Everything above a connector that is *about content* rather than about
 * repositories — validating against the model, deriving slugs, deciding which
 * files an entry is made of, and keeping `_order.json` in step.
 *
 * It lives in this package rather than in the CMS so the Astro build and the
 * server run the same code. Four things it deliberately does not do:
 *
 *   - **Identity.** An entry *is* its slug and its path, not a generated id.
 *     Renaming moves the directory, which is what an editor means by it and
 *     what a reviewer sees in the diff.
 *   - **Revisions.** Git has history. A second copy inside Mica would make
 *     Mica the thing that must not be lost.
 *   - **Draft/published status.** Committed is published; a draft is unsaved
 *     work in the editor that never reaches the repository.
 *   - **Media expansion.** A media value is a path. There is nothing to expand.
 */

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
  readCollection,
  readSingleton,
  relativizeMedia,
  resolveSlugField,
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
  ConnectorError,
  type Author,
  type Change,
  type RepositoryConnector,
} from "@micacms/core";

export class ContentError extends ConnectorError {
  override name = "ContentError";
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
  /**
   * The revision `slug` had when the editor opened it.
   *
   * Passing it is what makes a save safe against a repository that moved. It is
   * optional so that an import can write unconditionally, and every path an
   * editor takes should supply it.
   */
  expectedRevision?: string | null;
  author?: Author;
}

export interface SavedEntry {
  slug: string;
  title: string;
  /**
   * The entry's revision *after* this save, ready to be sent back with the
   * next one.
   *
   * Not the commit's identity. The two are different things — a commit
   * addresses a change set, a revision addresses one file — and returning the
   * commit here means every second save is refused as somebody else's edit.
   */
  revision: string;
  /** True when the save moved the entry's files. */
  renamed: boolean;
}

export function createContentStore(site: Site, connector: RepositoryConnector) {
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

  const validate = (
    def: Collection | Singleton,
    data: unknown,
    what: string,
  ): Record<string, unknown> => {
    const result = validateFields(def.fields, data, "storage");
    if (!result.ok) {
      throw new ValidationError(
        `${what} cannot be saved until these fields are correct.`,
        result.issues,
      );
    }
    return result.data as Record<string, unknown>;
  };

  /**
   * Files that belong to an entry now, so the ones that no longer do can be
   * removed in the same commit.
   *
   * Clearing a rich-text field means its `.mdoc` must disappear; leaving it
   * would make the next read resurrect the text. Media is deliberately left
   * alone — a file an editor uploaded is not garbage just because no field
   * currently points at it, and deleting it on save would lose work.
   */
  const staleDocuments = async (base: string, keep: Set<string>): Promise<Change[]> => {
    const changes: Change[] = [];

    for (const item of await connector.list(base)) {
      if (item.type !== "file") continue;
      if (!item.name.endsWith(DOCUMENT_EXTENSION)) continue;
      if (keep.has(item.name)) continue;
      changes.push({ type: "delete", path: `${base}/${item.name}` });
    }

    return changes;
  };

  /**
   * The revision of a file that was just written.
   *
   * A save hands this to the editor, who sends it back with their next save.
   * It must be the file's revision and never the commit's: a commit names a
   * change set, and comparing one against a file's revision can only ever say
   * "somebody else edited this".
   *
   * Absent means the write did not produce the file the caller named. Returning
   * an empty token instead would be quietly handing back a revision that can
   * never match, which is the failure this exists to prevent.
   */
  const revisionAfterWrite = async (path: string): Promise<string> => {
    const revision = await connector.revision(path);
    if (revision === null) {
      throw new ContentError(`Saved, but "${path}" is not in the repository afterwards.`);
    }
    return revision;
  };

  /**
   * The order file with a renamed slug in its old place, or null when the file
   * does not list it. Without it a renamed entry drops to the end of the list.
   */
  const renameInOrder = async (name: string, from: string, to: string): Promise<Change | null> => {
    const path = `${name}/${ORDER_FILE}`;
    const raw = await connector.read(path);
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
    const entries = await readCollection(connector, def, name);
    return entries.map((entry) => entry.slug).filter((slug) => slug !== except);
  };

  return {
    /* ------------------------------------------------------ reading */

    async list(collectionName: string): Promise<ContentEntry[]> {
      return readCollection(connector, requireCollection(collectionName), collectionName);
    },

    async get(collectionName: string, slug: string): Promise<ContentEntry | null> {
      const entries = await this.list(collectionName);
      return entries.find((entry) => entry.slug === slug) ?? null;
    },

    /** The revision an editor must send back with a save of this entry. */
    async revisionOf(collectionName: string, slug: string): Promise<string | null> {
      const def = requireCollection(collectionName);
      return connector.revision(dataPath(def, collectionName, slug));
    },

    /** The revision an editor must send back with a save of this singleton. */
    async revisionOfSingleton(name: string): Promise<string | null> {
      const def = requireSingleton(name);
      return connector.revision(singletonDataPath(def, name));
    },

    async getSingleton(name: string): Promise<Record<string, unknown>> {
      const def = requireSingleton(name);
      const data = await readSingleton(connector, def, name);
      // A singleton with no file yet is not missing content — it is content
      // nobody has filled in. The editor should open an empty form, not a 404.
      return withDefaults(def.fields, data);
    },

    /* ------------------------------------------------------ writing */

    async save(collectionName: string, input: SaveEntryInput): Promise<SavedEntry> {
      const def = requireCollection(collectionName);
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

      // Back to the on-disk form. The editor works in root-relative paths
      // because that is what `readCollection` hands it; writing those through
      // unchanged would bake the entry's own directory into the stored path.
      // A rename relativizes against the old directory, whose media moves along.
      const serialized = serializeEntry(
        def.fields,
        mediaForDisk(def.fields, data, previousBase ?? base),
      );
      const files = entryFiles(def.fields, base, serialized);

      const changes: Change[] = Object.entries(files).map(([path, contents]) => ({
        type: "write",
        path,
        contents,
      }));

      if (previousBase) {
        // A rename moves the whole entry, media included, so the directory goes
        // rather than the files being deleted one by one.
        changes.push(
          entryLayout(def.fields) === "directory"
            ? { type: "deleteTree", path: previousBase }
            : { type: "delete", path: previousBase },
        );
        await moveMedia(connector, previousBase, base, changes);
        const order = await renameInOrder(collectionName, input.slug!, slug);
        if (order) changes.push(order);
      } else if (entryLayout(def.fields) === "directory") {
        changes.push(...(await staleDocuments(base, new Set(Object.keys(serialized.documents)))));
      }

      const title = entryTitle(def, data);
      await connector.commit({
        message: previousBase
          ? `${def.labelSingular ?? def.label}: rename ${input.slug} to ${slug}`
          : `${def.labelSingular ?? def.label}: ${title}`,
        changes,
        expect:
          input.expectedRevision === undefined
            ? undefined
            : { [dataPath(def, collectionName, input.slug ?? slug)]: input.expectedRevision },
        author: input.author,
      });

      // Deliberately not the commit's own identity, which addresses the change
      // set rather than the file. The caller sends this straight back with
      // their next save, and it is compared against the entry's data file — so
      // it has to be that file's revision, read after the write, and at the new
      // path when the save was a rename.
      const revision = await revisionAfterWrite(dataPath(def, collectionName, slug));

      return { slug, title, revision, renamed: previousBase !== null };
    },

    async remove(
      collectionName: string,
      slug: string,
      options: { expectedRevision?: string | null; author?: Author } = {},
    ): Promise<void> {
      const def = requireCollection(collectionName);
      // One path segment: an empty slug or `a/b` would delete more than one entry.
      if (slug === "" || slug.includes("/") || slug === "." || slug === "..") {
        throw new ContentPathError(`"${slug}" is not an entry of "${collectionName}".`);
      }
      const base = collectionEntryPath(def.fields, collectionName, slug);

      await connector.commit({
        message: `${def.labelSingular ?? def.label}: delete ${slug}`,
        changes: [
          entryLayout(def.fields) === "directory"
            ? { type: "deleteTree", path: base }
            : { type: "delete", path: base },
        ],
        expect:
          options.expectedRevision === undefined
            ? undefined
            : { [dataPath(def, collectionName, slug)]: options.expectedRevision },
        author: options.author,
      });
    },

    async saveSingleton(
      name: string,
      payload: unknown,
      options: { expectedRevision?: string | null; author?: Author } = {},
    ): Promise<{ revision: string }> {
      const def = requireSingleton(name);
      const data = validate(def, payload, `The "${def.label}" settings`);

      const base = singletonPath(def.fields, name);
      const serialized = serializeEntry(def.fields, mediaForDisk(def.fields, data, base));

      const changes: Change[] = Object.entries(entryFiles(def.fields, base, serialized)).map(
        ([path, contents]) => ({ type: "write", path, contents }),
      );

      if (entryLayout(def.fields) === "directory") {
        changes.push(...(await staleDocuments(base, new Set(Object.keys(serialized.documents)))));
      }

      await connector.commit({
        message: `${def.label}: update`,
        changes,
        expect:
          options.expectedRevision === undefined
            ? undefined
            : { [singletonDataPath(def, name)]: options.expectedRevision },
        author: options.author,
      });

      // The file's new revision, not the commit's. See `save` above: the editor
      // sends this back when they change one more thing without reloading.
      return { revision: await revisionAfterWrite(singletonDataPath(def, name)) };
    },

    /**
     * Records the order an editor arranged a collection in.
     *
     * Only the order file is written. Reordering used to rewrite a `position`
     * column on every row; now one drag is a one-line diff, which is both
     * cheaper and reviewable.
     */
    async reorder(
      collectionName: string,
      slugs: string[],
      options: { author?: Author } = {},
    ): Promise<void> {
      const def = requireCollection(collectionName);
      if (!def.sortable) {
        throw new ContentError(`The "${def.label}" collection is not manually sortable.`);
      }

      await connector.commit({
        message: `${def.label}: reorder`,
        changes: [
          {
            type: "write",
            path: `${collectionName}/${ORDER_FILE}`,
            contents: `${JSON.stringify(slugs, null, 2)}\n`,
          },
        ],
        author: options.author,
      });
    },

    /* ---------------------------------------------------- utilities */

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
        const keys = Object.entries(def.fields)
          .filter(([, field]) => field.kind === "relation" && field.collection === collectionName)
          .map(([key]) => key);

        if (keys.length === 0) continue;

        for (const entry of await readCollection(connector, def, name)) {
          const points = keys.some((key) => {
            const value = entry.data[key];
            return Array.isArray(value) ? value.includes(slug) : value === slug;
          });
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

/* ------------------------------------------------------------------ */

/** The file whose revision identifies an entry, for concurrency checks. */
/**
 * Media paths as the repository stores them.
 *
 * Mirrors the read side, which resolves media only for directory-shaped
 * entries: a file-shaped entry has no directory of its own for a colocated
 * path to be relative to, so there is nothing to undo.
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

/**
 * The slug for a payload: what was asked for, what the payload says, or one
 * derived from the title.
 */
function pickSlug(
  def: Collection,
  data: Record<string, unknown>,
  current: string | undefined,
): string {
  const slugKey = resolveSlugField(def)!;
  const fromData = data[slugKey];

  const candidate =
    (typeof fromData === "string" && fromData.trim()) || slugify(entryTitle(def, data));

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
 * Carries colocated media across a rename.
 *
 * The serializer records media paths but never moves bytes, so a rename would
 * otherwise leave every image behind in a directory that is about to be
 * deleted. Read and rewritten rather than referenced, because a connector has
 * no notion of moving a file — only of writing one and deleting another.
 */
async function moveMedia(
  connector: RepositoryConnector,
  from: string,
  to: string,
  changes: Change[],
): Promise<void> {
  for (const item of await connector.list(`${from}/media`)) {
    if (item.type !== "file") continue;

    const bytes = await connector.readBinary(`${from}/media/${item.name}`);
    if (bytes === null) continue;

    changes.push({ type: "write", path: `${to}/media/${item.name}`, contents: bytes });
  }
}

/**
 * Content service — the business rules that sit between HTTP and SQL.
 *
 * Three responsibilities the routes must not have to repeat:
 *   • validation against the shared model, strict on publish and lenient on
 *     draft, so an editor can save unfinished work;
 *   • a revision snapshot taken before every destructive write;
 *   • media reference expansion, so the API returns usable objects while
 *     storage keeps only ids.
 */

import { createHash } from "node:crypto";

import {
  collectMediaIds,
  entryTitle,
  isValidSlug,
  resolveSlugField,
  slugify,
  uniqueSlug,
  validateFields,
  withDefaults,
  type Collection,
  type Entry,
  type EntryStatus,
  type FieldMap,
  type MediaRef,
  type Singleton,
  type Site,
} from "@micacms/model";

import { badRequest, conflict, notFound, validationFailed } from "../lib/errors.js";
import type { EntryRecord, EntryRepository } from "../repositories/entries.js";
import type { GlobalRepository } from "../repositories/globals.js";
import type { MediaRecord, MediaRepository } from "../repositories/media.js";
import type { RevisionRepository } from "../repositories/revisions.js";
import type { SqlDatabase } from "../db/driver.js";
import type { Publisher } from "./publisher.js";

/** Revisions kept per entry before the oldest are discarded. */
const REVISIONS_KEPT = 30;

export interface Actor {
  id: string;
  email: string;
}

export interface SaveEntryInput {
  data: Record<string, unknown>;
  status?: EntryStatus;
  slug?: string;
}

export function mediaUrl(record: MediaRecord, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/media/${record.storageKey}`;
}

export function toMediaRef(record: MediaRecord, baseUrl: string): MediaRef {
  return {
    id: record.id,
    url: mediaUrl(record, baseUrl),
    filename: record.filename,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    size: record.size,
    alt: record.altText || null,
  };
}

/**
 * Replaces media ids with full references, at any nesting depth.
 * An id with no matching row resolves to null rather than throwing: a deleted
 * asset should leave a gap on the page, not break the whole build.
 */
export function expandMedia(
  fields: FieldMap,
  data: Record<string, unknown>,
  lookup: Map<string, MediaRef>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };

  for (const [key, field] of Object.entries(fields)) {
    const value = result[key];
    if (value === null || value === undefined) continue;

    switch (field.kind) {
      case "media":
        if (field.multiple) {
          result[key] = (Array.isArray(value) ? value : [])
            .map((id) => (typeof id === "string" ? lookup.get(id) : undefined))
            .filter((ref): ref is MediaRef => ref !== undefined);
        } else {
          result[key] = typeof value === "string" ? (lookup.get(value) ?? null) : null;
        }
        break;

      case "object":
        result[key] = expandMedia(field.fields, value as Record<string, unknown>, lookup);
        break;

      case "repeater":
        result[key] = (Array.isArray(value) ? value : []).map((row) =>
          expandMedia(field.fields, row as Record<string, unknown>, lookup),
        );
        break;

      default:
        break;
    }
  }

  return result;
}

export interface ContentServiceDeps {
  site: Site;
  db: SqlDatabase;
  entries: EntryRepository;
  globals: GlobalRepository;
  revisions: RevisionRepository;
  media: MediaRepository;
  publisher: Publisher;
  baseUrl: string;
}

export function createContentService(deps: ContentServiceDeps) {
  const { site, db, entries, globals, revisions, media, publisher, baseUrl } = deps;

  // The model cannot change without restarting the process, so this is computed
  // once. It is the same digest `schemaFingerprint` logs at startup, which makes
  // a mismatch between a website's build and the CMS serving it readable in the
  // logs rather than only in its effects.
  const schemaDigest = createHash("sha256")
    .update(JSON.stringify(site))
    .digest("hex")
    .slice(0, 12);

  const requireCollection = (name: string): Collection => {
    const def = site.collections[name];
    if (!def) throw notFound(`Unknown collection "${name}".`);
    return def;
  };

  const requireSingleton = (name: string): Singleton => {
    const def = site.singletons[name];
    if (!def) throw notFound(`Unknown global "${name}".`);
    return def;
  };

  /** Builds the id → reference map for a set of payloads in one query. */
  const mediaLookup = (fields: FieldMap, payloads: Record<string, unknown>[]): Map<string, MediaRef> => {
    const ids = new Set<string>();
    for (const payload of payloads) {
      for (const id of collectMediaIds(fields, payload)) ids.add(id);
    }
    if (ids.size === 0) return new Map();

    return new Map(
      media.findMany([...ids]).map((record) => [record.id, toMediaRef(record, baseUrl)]),
    );
  };

  const toEntry = (def: Collection, record: EntryRecord, lookup: Map<string, MediaRef>): Entry => ({
    id: record.id,
    collection: record.collection,
    slug: record.slug,
    status: record.status,
    position: record.position,
    data: expandMedia(def.fields, withDefaults(def.fields, record.data), lookup),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    publishedAt: record.publishedAt,
    version: record.version,
  });

  /**
   * Validates a payload. Publishing enforces `required`; saving a draft does
   * not, so unfinished work is never lost to a validation error.
   */
  const validate = (
    fields: FieldMap,
    data: unknown,
    status: EntryStatus,
  ): Record<string, unknown> => {
    const result = validateFields(fields, data, "storage", {
      enforceRequired: status === "published",
    });
    if (!result.ok) {
      throw validationFailed(
        result.issues,
        status === "published"
          ? "This entry cannot be published until these fields are correct."
          : "Some fields could not be saved.",
      );
    }
    return result.data as Record<string, unknown>;
  };

  /** Derives the slug from the payload, keeps it unique within the collection. */
  const resolveSlug = (
    def: Collection,
    data: Record<string, unknown>,
    explicit: string | undefined,
    exceptId?: string,
  ): string => {
    const slugKey = resolveSlugField(def)!;
    const fromData = data[slugKey];
    const candidate =
      explicit?.trim() ||
      (typeof fromData === "string" && fromData.trim()) ||
      slugify(entryTitle(def, data));

    if (!candidate) {
      throw badRequest("An entry needs a title or a URL before it can be saved.");
    }

    const normalised = isValidSlug(candidate) ? candidate : slugify(candidate);
    if (!normalised) {
      throw badRequest(`"${candidate}" cannot be turned into a URL. Use letters and numbers.`);
    }

    return uniqueSlug(normalised, entries.slugs(def.name, exceptId));
  };

  const snapshot = (record: EntryRecord, def: Collection, actor: Actor | null, note: string) => {
    revisions.create({
      targetType: "entry",
      targetId: record.id,
      collection: record.collection,
      version: record.version,
      slug: record.slug,
      status: record.status,
      title: entryTitle(def, record.data),
      data: record.data,
      note,
      userId: actor?.id ?? null,
    });
    revisions.prune("entry", record.id, REVISIONS_KEPT);
  };

  /** Only a change involving published content can affect the live site. */
  const notifyIfLive = async (
    before: EntryStatus | null,
    after: EntryStatus | null,
    event: Parameters<Publisher["publish"]>[0],
  ): Promise<void> => {
    if (before !== "published" && after !== "published") return;
    await publisher.publish(event);
  };

  return {
    /* -------------------------------------------------- admin: entries */

    listEntries(
      collectionName: string,
      options: {
        status?: EntryStatus;
        search?: string;
        limit?: number;
        offset?: number;
        sort?: Collection["defaultSort"];
      } = {},
    ) {
      const def = requireCollection(collectionName);
      const sort = options.sort ?? def.defaultSort;

      const { items, total } = entries.list({
        collection: collectionName,
        status: options.status,
        search: options.search,
        sort: sort?.field,
        direction: sort?.direction,
        limit: options.limit,
        offset: options.offset,
      });

      const lookup = mediaLookup(
        def.fields,
        items.map((item) => item.data),
      );

      return {
        items: items.map((record) => ({
          ...toEntry(def, record, lookup),
          title: entryTitle(def, record.data),
        })),
        total,
      };
    },

    getEntry(id: string) {
      const record = entries.findById(id);
      if (!record) throw notFound("This entry no longer exists.");

      const def = requireCollection(record.collection);
      const lookup = mediaLookup(def.fields, [record.data]);

      return {
        ...toEntry(def, record, lookup),
        title: entryTitle(def, record.data),
        // The form binds to ids, so it needs the raw payload alongside the
        // expanded one, plus the referenced media for previews.
        raw: withDefaults(def.fields, record.data),
        media: [...lookup.values()],
      };
    },

    async createEntry(collectionName: string, input: SaveEntryInput, actor: Actor | null) {
      const def = requireCollection(collectionName);
      const status = input.status ?? "draft";
      const data = validate(def.fields, input.data, status);
      const slug = resolveSlug(def, data, input.slug);

      const slugKey = resolveSlugField(def)!;
      data[slugKey] = slug;

      const record = db.transaction(() =>
        entries.create({
          collection: collectionName,
          slug,
          status,
          data,
          userId: actor?.id ?? null,
        }),
      );

      await notifyIfLive(null, status, {
        type: status === "published" ? "entry.published" : "entry.updated",
        collection: collectionName,
        slug,
        entryId: record.id,
        actor,
      });

      return this.getEntry(record.id);
    },

    async updateEntry(id: string, input: SaveEntryInput, actor: Actor | null) {
      const current = entries.findById(id);
      if (!current) throw notFound("This entry no longer exists.");

      const def = requireCollection(current.collection);
      const status = input.status ?? current.status;
      const data = validate(def.fields, input.data, status);
      const slug = resolveSlug(def, data, input.slug, id);

      const slugKey = resolveSlugField(def)!;
      data[slugKey] = slug;

      const updated = db.transaction(() => {
        snapshot(current, def, actor, status === current.status ? "Edited" : `Status → ${status}`);
        return entries.update(id, { slug, status, data, userId: actor?.id ?? null });
      });

      if (!updated) throw notFound("This entry no longer exists.");

      await notifyIfLive(current.status, status, {
        type:
          current.status !== "published" && status === "published"
            ? "entry.published"
            : current.status === "published" && status !== "published"
              ? "entry.unpublished"
              : "entry.updated",
        collection: current.collection,
        slug,
        entryId: id,
        actor,
      });

      return this.getEntry(id);
    },

    async setEntryStatus(id: string, status: EntryStatus, actor: Actor | null) {
      const current = entries.findById(id);
      if (!current) throw notFound("This entry no longer exists.");

      // Publishing re-runs validation strictly — a draft may be incomplete.
      const def = requireCollection(current.collection);
      const data = validate(def.fields, current.data, status);

      const updated = db.transaction(() => {
        snapshot(current, def, actor, `Status → ${status}`);
        return entries.update(id, { status, data, userId: actor?.id ?? null });
      });

      if (!updated) throw notFound("This entry no longer exists.");

      await notifyIfLive(current.status, status, {
        type: status === "published" ? "entry.published" : "entry.unpublished",
        collection: current.collection,
        slug: current.slug,
        entryId: id,
        actor,
      });

      return this.getEntry(id);
    },

    async deleteEntry(id: string, actor: Actor | null) {
      const current = entries.findById(id);
      if (!current) throw notFound("This entry no longer exists.");

      const def = requireCollection(current.collection);

      db.transaction(() => {
        snapshot(current, def, actor, "Deleted");
        entries.delete(id);
      });

      await notifyIfLive(current.status, null, {
        type: "entry.deleted",
        collection: current.collection,
        slug: current.slug,
        entryId: id,
        actor,
      });
    },

    async reorderEntries(collectionName: string, orderedIds: string[], actor: Actor | null) {
      const def = requireCollection(collectionName);
      if (!def.sortable) {
        throw badRequest(`The "${def.label}" collection is not manually sortable.`);
      }

      entries.reorder(collectionName, orderedIds);
      await publisher.publish({ type: "entry.updated", collection: collectionName, actor });
    },

    /* ------------------------------------------------ admin: revisions */

    listRevisions(entryId: string) {
      const record = entries.findById(entryId);
      if (!record) throw notFound("This entry no longer exists.");
      return revisions.list("entry", entryId);
    },

    async restoreRevision(entryId: string, revisionId: string, actor: Actor | null) {
      const current = entries.findById(entryId);
      if (!current) throw notFound("This entry no longer exists.");

      const revision = revisions.find(revisionId);
      if (!revision || revision.targetId !== entryId) {
        throw notFound("This revision no longer exists.");
      }

      const def = requireCollection(current.collection);
      // The old payload is validated leniently: the model may have gained a
      // required field since, and a restore should still succeed as a draft.
      const restored = validateFields(def.fields, revision.data, "storage", {
        enforceRequired: false,
      });
      if (!restored.ok) throw validationFailed(restored.issues, "This revision cannot be restored.");

      const data = restored.data as Record<string, unknown>;
      const slug = resolveSlug(def, data, revision.slug ?? undefined, entryId);
      data[resolveSlugField(def)!] = slug;

      const updated = db.transaction(() => {
        snapshot(current, def, actor, "Before restore");
        return entries.update(entryId, {
          slug,
          data,
          status: current.status,
          userId: actor?.id ?? null,
        });
      });

      if (!updated) throw notFound("This entry no longer exists.");

      await notifyIfLive(current.status, current.status, {
        type: "entry.updated",
        collection: current.collection,
        slug,
        entryId,
        actor,
      });

      return this.getEntry(entryId);
    },

    /* -------------------------------------------------- admin: globals */

    getGlobal(name: string) {
      const def = requireSingleton(name);
      const record = globals.find(name);
      const data = withDefaults(def.fields, record?.data);
      const lookup = mediaLookup(def.fields, [data]);

      return {
        name,
        data: expandMedia(def.fields, data, lookup),
        raw: data,
        media: [...lookup.values()],
        version: record?.version ?? 0,
        updatedAt: record?.updatedAt ?? null,
      };
    },

    async saveGlobal(name: string, payload: unknown, actor: Actor | null) {
      const def = requireSingleton(name);

      // A singleton is live the moment it is saved, so it is always strict.
      const result = validateFields(def.fields, payload, "storage");
      if (!result.ok) throw validationFailed(result.issues);

      const data = result.data as Record<string, unknown>;
      const previous = globals.find(name);

      db.transaction(() => {
        if (previous) {
          revisions.create({
            targetType: "global",
            targetId: name,
            version: previous.version,
            title: def.label,
            data: previous.data,
            note: "Edited",
            userId: actor?.id ?? null,
          });
          revisions.prune("global", name, REVISIONS_KEPT);
        }
        globals.save(name, data, actor?.id ?? null);
      });

      await publisher.publish({ type: "global.updated", global: name, actor });
      return this.getGlobal(name);
    },

    listGlobalRevisions(name: string) {
      requireSingleton(name);
      return revisions.list("global", name);
    },

    async restoreGlobalRevision(name: string, revisionId: string, actor: Actor | null) {
      const def = requireSingleton(name);
      const revision = revisions.find(revisionId);
      if (!revision || revision.targetId !== name) {
        throw notFound("This revision no longer exists.");
      }

      const restored = validateFields(def.fields, revision.data, "storage", {
        enforceRequired: false,
      });
      if (!restored.ok) throw validationFailed(restored.issues, "This revision cannot be restored.");

      return this.saveGlobal(name, restored.data, actor);
    },

    /* ---------------------------------------------------- public API */

    /** Published entries only, media expanded, validated on the way out. */
    publicCollection(collectionName: string): Entry[] {
      const def = requireCollection(collectionName);
      const records = entries.listPublished(collectionName, def.defaultSort?.field ?? "position");
      const lookup = mediaLookup(
        def.fields,
        records.map((record) => record.data),
      );
      return records.map((record) => toEntry(def, record, lookup));
    },

    publicEntry(collectionName: string, slug: string): Entry {
      const def = requireCollection(collectionName);
      const record = entries.findPublishedBySlug(collectionName, slug);
      if (!record) throw notFound(`No published entry "${slug}" in "${collectionName}".`);
      return toEntry(def, record, mediaLookup(def.fields, [record.data]));
    },

    publicGlobal(name: string): Record<string, unknown> {
      const def = requireSingleton(name);
      const record = globals.find(name);
      const data = withDefaults(def.fields, record?.data);
      return expandMedia(def.fields, data, mediaLookup(def.fields, [data]));
    },

    /**
     * Change token so a build can skip work when nothing moved.
     *
     * Two inputs, because two things decide what `/manifest` returns:
     *
     *   - the published rows, identified rather than counted. A timestamp and a
     *     count miss compensating edits — delete one published entry, publish
     *     another, and `MAX(updated_at)-COUNT(*)` can land back where it
     *     started. Every row's id and version go in instead, so membership and
     *     content are both covered: an edit bumps `version`, and publishing or
     *     unpublishing moves a row in or out of the set.
     *   - the model itself. Payloads are projected through it on the way out —
     *     defaults filled, media expanded — so the same rows under a changed
     *     `mica.config.ts` are a different response. Without this, editing the
     *     model and restarting the CMS leaves every consumer convinced nothing
     *     happened, which is exactly the case a content-only token cannot see.
     *
     * The scan is over an index and the token is polled a few times a minute by
     * a dev server, against content volumes this CMS is sized for. If that ever
     * stops being true, the fix is a counter bumped on write, not a coarser
     * token.
     */
    /** The model's digest alone, without the content half of the token. */
    schemaFingerprint(): string {
      return schemaDigest;
    },

    contentVersion(): string {
      const rows = db.all<{ token: string }>(
        `SELECT id || ':' || version AS token FROM entries WHERE status = 'published' ORDER BY id`,
      );
      const globalRows = db.all<{ token: string }>(
        `SELECT name || ':' || version AS token FROM globals ORDER BY name`,
      );

      const digest = createHash("sha256");
      for (const row of rows) digest.update(row.token).update("\n");
      digest.update("--\n");
      for (const row of globalRows) digest.update(row.token).update("\n");

      return `${schemaDigest}-${digest.digest("hex").slice(0, 16)}`;
    },

    /* ------------------------------------------------------- utilities */

    requireCollection,
    requireSingleton,

    /** Slug suggestions for the admin, so the URL preview matches the server. */
    suggestSlug(collectionName: string, source: string, exceptId?: string): string {
      const def = requireCollection(collectionName);
      return uniqueSlug(slugify(source), entries.slugs(def.name, exceptId));
    },

    /** Entries pointing at `slug`, so the UI can warn before a delete. */
    findReferences(collectionName: string, slug: string) {
      const results: Array<{ collection: string; id: string; title: string; slug: string }> = [];

      for (const def of Object.values(site.collections)) {
        for (const [key, field] of Object.entries(def.fields)) {
          if (field.kind !== "relation" || field.collection !== collectionName) continue;
          for (const record of entries.referencing(def.name, key, slug)) {
            results.push({
              collection: def.name,
              id: record.id,
              title: entryTitle(def, record.data),
              slug: record.slug,
            });
          }
        }
      }

      return results;
    },
  };
}

export type ContentService = ReturnType<typeof createContentService>;

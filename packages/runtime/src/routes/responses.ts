/**
 * The response shapes of the admin routes that no service type describes. The
 * routes check their answers against them, and the editor imports them as
 * types, so the two cannot drift apart.
 */

import type { AnyField } from "@micacms/core/internal";

import type { OperationalFact } from "../context.js";
import type { CollectionStats, SchemaStats } from "../lib/schema-stats.js";
import type { RepositoryInfo, StagingStatus } from "../services/changes.js";

export interface SchemaCollection {
  name: string;
  label: string;
  labelSingular: string;
  description: string | null;
  sortable: boolean;
  defaultSort: { field: string; direction: "asc" | "desc" } | null;
  /** Null when no field of the collection can be its title or its URL. */
  titleField: string | null;
  slugField: string | null;
  listedFields: string[];
  fields: Record<string, AnyField>;
  /** The model's `url`, such as `/news/{slug}`, or null. */
  url: string | null;
  /** The page of an entry on the website, with `{slug}`; null without `url` in the model or `MICA_SITE_URL`. */
  page: string | null;
  /** Why this build of Mica cannot edit it, or null. Set when the model uses a newer field kind. */
  readOnly: string | null;
}

export interface SchemaSingleton {
  name: string;
  label: string;
  description: string | null;
  fields: Record<string, AnyField>;
  /** The model's `url`, such as `/about`, or null. */
  url: string | null;
  /** Its page on the website; null without `url` in the model or `MICA_SITE_URL`. */
  page: string | null;
  /** Why this build of Mica cannot edit it, or null. Set when the model uses a newer field kind. */
  readOnly: string | null;
}

/** Data from a file of the website that relations point to; Mica never edits it. */
export interface SchemaReferenceSet {
  name: string;
  label: string;
}

/** `/schema`: the content model, plus the derived values that the editor would otherwise compute again. */
export interface Schema {
  collections: SchemaCollection[];
  singletons: SchemaSingleton[];
  references: SchemaReferenceSet[];
  /** The model's revision; the pending changes name the one the server uses now. */
  revision: string | null;
}

/** One entry in a collection's list. */
export interface EntrySummary {
  /** The entry's identity. There is no id: the slug is the path. */
  slug: string;
  position: number;
  title: string;
  data: Record<string, unknown>;
}

export interface EntryDetail {
  collection: string;
  slug: string;
  title: string;
  data: Record<string, unknown>;
  /** The entry's folder, relative to the content root. */
  path: string;
  /**
   * The version the form was opened against, sent back with the save. `null` means a new entry,
   * so two people who create the same slug get a conflict, not a silent loss.
   */
  revision: string | null;
}

export interface SingletonDetail {
  name: string;
  label: string;
  /** Path in the repository, relative to the content root. */
  path: string;
  data: Record<string, unknown>;
  revision: string | null;
}

/** Which model the server uses, so that a page can tell a stale form, and why a newer one is not in use. */
export interface ModelState {
  revision: string | null;
  /** Set while a newer model cannot be read. Saves, uploads and Publish are refused until then. */
  warning: string | null;
}

/** `/changes`: the pending change set, and the model the server checks it with. */
export interface ChangesResponse extends StagingStatus {
  model: ModelState;
}

export interface MediaUsage {
  files: number;
  bytes: number;
  readable: string;
}

/** `/overview`: what the dashboard shows. */
export interface Overview {
  collections: Array<{ name: string; label: string; total: number }>;
  media: MediaUsage;
  repository: string;
}

/** `/system`: everything the System page shows. It never holds a secret value. */
export interface SystemInfo {
  cms: {
    version: string;
    /** "self-hosted" or "local editor". */
    mode: string;
    node: string;
    platform: string;
    startedAt: string;
    uptimeSeconds: number;
  };
  schema: Omit<SchemaStats, "collections"> & {
    collections: Array<CollectionStats & { entries: number }>;
    /** Why a newer model is not in use: the developer's change cannot be read. */
    warning: string | null;
  };
  /** The website's content. Git is its backup. */
  repository: RepositoryInfo & {
    origin: string;
    entries: number;
    media: MediaUsage;
  };
  deployment: {
    baseUrl: string;
    /** Where the content model was read from, e.g. `<repo>/.mica/schema.json`. */
    schemaOrigin: string;
    /** Null unless the repository is a working tree on this machine. */
    contentRoot: string | null;
    dataDir: string | null;
    logLevel: string;
    maxUploadBytes: number;
    maxUploadReadable: string;
    /** How this deployment authenticates, in words. */
    auth: string;
    /** What decides who may edit here. Null where nothing does the deciding. */
    admission: string | null;
    /** More facts of the composition, such as how long a session lasts. */
    facts: OperationalFact[];
    trustProxy: boolean;
    adminOrigins: string[];
    memoryBytes: number;
  };
}

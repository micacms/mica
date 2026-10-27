/**
 * The response shapes of the admin routes that no service type describes. The
 * routes check their answers against them, and the editor imports them as
 * types, so the two cannot drift apart.
 */

import type { AnyField } from "@micacms/core/internal";

import type { OperationalFact } from "../context.js";
import type { ProblemLine } from "../lib/logger.js";
import type { CollectionStats, SchemaStats } from "../lib/schema-stats.js";
import type { Comparison, RepositoryInfo, StagingStatus } from "../services/changes.js";

export interface SchemaCollection {
  name: string;
  label: string;
  labelSingular: string;
  description: string | null;
  sortable: boolean;
  defaultSort: { field: string; direction: "asc" | "desc" } | null;
  /** Null when no field of the collection can be its title or its ID. */
  titleField: string | null;
  idField: string | null;
  listedFields: string[];
  fields: Record<string, AnyField>;
  /** The model's `url`, such as `/news/{id}`, or null. */
  url: string | null;
  /** The page of an entry on the website, with the names of `url`, such as `{id}`; null without `url` in the model or `MICA_SITE_URL`. */
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
/** The website, as the editor names it at the top of its menu. */
export interface SchemaSite {
  /** From `defineSite({ label })`; null without one. */
  label: string | null;
  /** `MICA_SITE_URL`, the published website; null without it. */
  url: string | null;
  /**
   * The site's locales, the default locale first, with their fallbacks; null for a site without locales.
   * `prefixDefault`: the default locale has its prefix in an address with `{locale}` too.
   */
  locales: { list: string[]; default: string; fallback: Record<string, string>; prefixDefault: boolean } | null;
}

/** Where the live preview stands: off, starting, live, or stopped after it ran or failed. */
export type PreviewState = "off" | "starting" | "live" | "stopped";

export interface PreviewStatus {
  state: PreviewState;
  /** The preview's address, while it is live. */
  address: string | null;
  /** Why it is not live and what to do, in the words of the deployment's readers; null while live. */
  detail: string | null;
  /** The last lines of the preview's output, the oldest first, where Mica can read them (ADR 40). */
  lines?: string[];
}

export interface Schema {
  site: SchemaSite;
  collections: SchemaCollection[];
  singletons: SchemaSingleton[];
  references: SchemaReferenceSet[];
  /** The model's revision; the pending changes name the one the server uses now. */
  revision: string | null;
}

/** One entry in a collection's list. */
export interface EntrySummary {
  /** The entry's identity: its ID, which is also the name of its folder. */
  id: string;
  position: number;
  title: string;
  data: Record<string, unknown>;
}

export interface EntryDetail {
  collection: string;
  id: string;
  title: string;
  data: Record<string, unknown>;
  /** The entry's folder, relative to the content root. */
  path: string;
  /**
   * The version the form was opened against, sent back with the save. `null` means a new entry,
   * so two people who create the same ID get a conflict, not a silent loss.
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

/** `/changes/compare?targets=…`: one result for each target, in its order. */
export interface CompareManyResponse {
  comparisons: Array<{ comparison: Comparison } | { error: string }>;
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
  /** The last warnings and errors of this process, the newest first (ADR 40). */
  problems: ProblemLine[];
  /** The live preview, with its last lines where Mica can read them (ADR 40). */
  preview: PreviewStatus;
}

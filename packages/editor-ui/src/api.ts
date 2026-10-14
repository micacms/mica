/**
 * Admin API client: one `request` function that attaches the CSRF header and
 * surfaces field-level issues for forms.
 */

import type { AnyField, FieldIssue } from "@micacms/core/internal";

const BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: FieldIssue[];

  constructor(status: number, code: string, message: string, issues: FieldIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }

  /** True when the session has gone; the shell reacts by showing the sign-in view. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}


/** The CSRF cookie is readable by design — it is echoed back as a header. `__Host-` over https. */
function csrfToken(): string {
  const match = /(?:^|;\s*)(?:__Host-)?mica_csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** A list repeats the parameter: `?path=a&path=b`. */
  query?: Record<string, string | number | boolean | string[] | undefined>;
  signal?: AbortSignal;
}

let onUnauthenticated: (() => void) | null = null;
let onSessionExpiry: ((at: string) => void) | null = null;

/** Called on every 401, so that the shell can say that the session ended. */
export function whenUnauthenticated(handler: () => void): void {
  onUnauthenticated = handler;
}

/** Called with the session's end from each response that names it. */
export function whenSessionExpiry(handler: (at: string) => void): void {
  onSessionExpiry = handler;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (Array.isArray(value)) for (const one of value) url.searchParams.append(key, one);
    else if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {};
  const method = options.method ?? "GET";

  if (method !== "GET") headers["x-csrf-token"] = csrfToken();

  // A file goes as it is: the server streams it to disk.
  const isFile = options.body instanceof Blob;
  if (options.body !== undefined && !isFile) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      signal: options.signal,
      body: isFile
        ? (options.body as Blob)
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "network_error", "Could not reach the server. Check your connection.");
  }

  const expires = response.headers.get("x-mica-session-expires");
  if (expires) onSessionExpiry?.(expires);

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    if (response.status === 401) onUnauthenticated?.();
    const envelope = payload as { error?: { code?: string; message?: string; issues?: FieldIssue[] } };
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? "error",
      envelope?.error?.message ?? `Request failed (${response.status}).`,
      envelope?.error?.issues ?? [],
    );
  }

  return payload as T;
}

/* ------------------------------------------------------------------ *
 * Response shapes
 * ------------------------------------------------------------------ */

export interface SchemaCollection {
  name: string;
  label: string;
  labelSingular: string;
  description: string | null;
  sortable: boolean;
  defaultSort: { field: string; direction: "asc" | "desc" } | null;
  titleField: string;
  slugField: string;
  listedFields: string[];
  fields: Record<string, AnyField>;
  /** Why this build of Mica cannot edit it, or null. Set when the model uses a newer field kind. */
  readOnly: string | null;
}

export interface SchemaSingleton {
  name: string;
  label: string;
  description: string | null;
  fields: Record<string, AnyField>;
  /** Why this build of Mica cannot edit it, or null. Set when the model uses a newer field kind. */
  readOnly: string | null;
}

export interface Schema {
  collections: SchemaCollection[];
  singletons: SchemaSingleton[];
  /** The model's revision; the pending changes name the one the server uses now. */
  revision: string | null;
}

/**
 * Who the identity provider said this is, kept only for the session. Null where
 * there is no provider.
 */
export interface Identity {
  /** The provider's subject. Stable, opaque, and not shown to anybody. */
  subject: string;
  email: string;
  name: string;
}

/** What the SPA needs before it can draw anything. */
export interface AuthConfig {
  /** False in local mode: no provider, no sign-in, and nobody to be. */
  authRequired: boolean;
  /** Hostname of the identity provider, for the button label. */
  provider: string | null;
}

export interface EntrySummary {
  collection: string;
  /** The entry's identity. There is no id: the slug is the path. */
  slug: string;
  title: string;
  position: number;
  data: Record<string, unknown>;
}

export interface EntryDetail extends Omit<EntrySummary, "position"> {
  /** The entry's folder, relative to the content root. */
  path: string;
  /**
   * The version the form was opened against, sent back with the save. `null` means a new entry,
   * so two people who create the same slug get a conflict, not a silent loss.
   */
  revision: string | null;
}

export interface SavedEntry {
  slug: string;
  title: string;
  revision: string;
  /** True when the save moved the entry to a new slug. */
  renamed: boolean;
  /** How many other entries and settings pages now link to the new URL. */
  relinked: number;
}

/** An entry or settings page that links to an entry. */
export type Referrer =
  | { kind: "entry"; collection: string; slug: string; title: string; readOnly?: true }
  | { kind: "singleton"; name: string; title: string; readOnly?: true };

export interface SingletonDetail {
  name: string;
  label: string;
  /** Path in the repository, relative to the content root. */
  path: string;
  data: Record<string, unknown>;
  revision: string | null;
}

/** Where a pending change happened, in words an editor recognises. */
export type ChangeOwner =
  | {
      kind: "entry";
      collection: string;
      slug: string;
      label: string;
      /** The slug before a pending rename. Set on the files of both slugs. */
      renamedFrom?: string;
    }
  | { kind: "singleton"; name: string; label: string }
  | { kind: "order"; collection: string; label: string }
  | { kind: "media"; label: string }
  | { kind: "other"; label: string };

/** One path the publication writes or deletes. See `lib/edits.ts` for the unit an editor sees. */
export interface FileChange {
  path: string;
  kind: "create" | "update" | "delete";
  owner: ChangeOwner;
  /** The file's revision when listed, null for a deletion. Sent back with Publish. */
  revision?: string | null;
  /** When the file was last saved. Null for a deletion. */
  savedAt?: string | null;
  /** New pending files that this document uses; it is published with them. */
  needs?: string[];
}

/** One thing that would make the pending set unpublishable. */
export interface StagingProblem {
  path: string;
  label: string;
  issues: FieldIssue[];
}

/** Something an editor changed that the website changed too. */
export interface SyncConflict {
  /** What `resolve` takes. */
  group: string;
  label: string;
  paths: string[];
  upstream: "changed" | "deleted" | "added";
  /** What the comparison with the website's version shows. */
  target?: CompareTarget;
}

/** Where Mica's own clone stands against the repository. Null for the developer's checkout. */
export interface SyncStatus {
  lastSyncAt: string | null;
  behind: number;
  error: { code: string; message: string; since: string } | null;
  /** A `.gitattributes` changed on the website; a restart applies it. A new content model needs none. */
  /** Published in Mica, not yet in the repository. Mica retries it. */
  pendingPush: { revision: string; reason: string } | null;
  /** The last publication the repository refused. It is a draft again. */
  refused: { reason: string; at: string } | null;
  conflicts: SyncConflict[];
}

/**
 * The pending change set — what is Saved and not yet Published.
 *
 * `owner` decides the words: the developer's checkout is a working tree and
 * publishing runs their own Git; the clone that a self-hosted Mica keeps is
 * worded for editors, who save and publish.
 */
export interface StagingStatus {
  owner: "developer" | "managed";
  publish: { enabled: boolean; reason?: string };
  /** The commit the pending changes sit on. For display. */
  head: string | null;
  branch: string | null;
  /**
   * The developer's checkout only: publications not yet sent to the website
   * (`mica`), and other work there that blocks Publish until it is sent (`other`).
   */
  unpushed: { mica: number; other: number } | null;
  /** File changes, not edits: count with `toEdits`, never with `.length`. */
  changes: FileChange[];
  validation: { ok: boolean; problems: StagingProblem[] };
  sync: SyncStatus | null;
  /** The model the server uses now, and why a newer one is not in use. */
  model?: { revision: string | null; warning: string | null };
}

export interface PublishOutcome {
  /** `committed-pending-push`: the commit exists, only the push failed. */
  state: "published" | "committed-pending-push";
  revision: string | null;
  pushError?: string;
}

/** One thing on the Publish page, named for a before/after comparison. */
export type CompareTarget =
  /** `from` names the published slug of a renamed entry. */
  | { kind: "entry"; collection: string; slug: string; from?: string }
  | { kind: "singleton"; name: string }
  | { kind: "order"; collection: string };

/**
 * A document on both sides of the pending change set: `before` as the
 * repository has it, `after` as staged. Null marks the side that does not
 * exist — a creation has no before, a deletion no after.
 */
export interface Comparison {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** The compared document's pending files at the revision shown: what Publish and Discard send back. */
  revisions: Record<string, string | null>;
}

/** A file in the content repository. */
export interface MediaItem {
  /** Path relative to the content root — the value a media field holds. */
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface Overview {
  collections: Array<{ name: string; label: string; total: number }>;
  media: { files: number; bytes: number; readable: string };
  repository: string;
}

export interface FieldCounts {
  /** Fields declared directly on the collection or singleton. */
  top: number;
  /** Every field, including those nested in objects and repeaters. */
  total: number;
  required: number;
}

export interface MediaUsage {
  files: number;
  bytes: number;
  readable: string;
}

/** Everything the System view shows. */
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
  schema: {
    /** Why a newer model is not in use: the developer's change cannot be read. */
    warning: string | null;
    totals: FieldCounts & { collections: number; singletons: number };
    kinds: Array<{ kind: string; count: number }>;
    relations: Array<{
      from: string;
      fromType: "collection" | "singleton";
      path: string;
      to: string;
      multiple: boolean;
    }>;
    collections: Array<{
      name: string;
      label: string;
      fields: FieldCounts;
      titleField: string | null;
      slugField: string | null;
      listed: number;
      sortable: boolean;
      depth: number;
      entries: number;
    }>;
    singletons: Array<{ name: string; label: string; fields: FieldCounts; depth: number }>;
  };
  /** The website's content. Git is its backup. */
  repository: {
    origin: string;
    entries: number;
    media: MediaUsage;
    owner: "developer" | "managed";
    branch: string | null;
    head: string | null;
    /** The remote of Mica's own clone, without credentials. */
    url: string | null;
    /** What the clone takes on the data volume. */
    cloneBytes: number | null;
    sync: SyncStatus | null;
  };
  deployment: {
    site: string;
    baseUrl: string;
    /** Where the content model was read from, e.g. `<repo>/.mica/schema.json`. */
    schemaOrigin: string;
    /** Null unless the repository is a working tree on this machine. */
    contentRoot: string | null;
    dataDir: string | null;
    logLevel: string;
    maxUploadBytes: number;
    maxUploadReadable: string;
    sessionTtlHours: number | null;
    sessionIdleHours: number | null;
    /** How this deployment authenticates, in words. */
    auth: string;
    /** What decides who may edit here. Null where nothing does the deciding. */
    admission: string | null;
    trustProxy: boolean;
    adminOrigins: string[];
    memoryBytes: number;
  };
}

/* ------------------------------------------------------------------ *
 * Endpoints
 * ------------------------------------------------------------------ */

export const api = {
  auth: {
    me: () =>
      request<{ identity: Identity | null; csrfToken: string; expiresAt: string }>("/auth/me"),
    config: () => request<AuthConfig>("/auth/config"),

    /**
     * A full-page navigation, not a fetch: the provider is another origin that
     * can set cookies and ask for consent or a second factor.
     */
    signInUrl: (returnTo: string) =>
      `${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`,

    logout: () =>
      request<{ ok: true; endSession: string | null }>("/auth/logout", { method: "POST" }),
  },

  schema: () => request<Schema>("/admin/schema"),
  overview: () => request<Overview>("/admin/overview"),
  system: () => request<SystemInfo>("/admin/system"),

  entries: {
    list: (collection: string, query: RequestOptions["query"] = {}) =>
      request<{ items: EntrySummary[]; total: number; orderRevision: string | null }>(
        `/admin/collections/${collection}/entries`,
        { query },
      ),
    get: (collection: string, slug: string) =>
      request<EntryDetail>(`/admin/collections/${collection}/entries/${slug}`),
    create: (collection: string, body: { data: unknown; revision?: string | null }) =>
      request<SavedEntry>(`/admin/collections/${collection}/entries`, { method: "POST", body }),
    /** `keepMine`: the editor saw a newer save and chose to save over it. */
    update: (
      collection: string,
      slug: string,
      body: { data: unknown; revision?: string | null; keepMine?: boolean; updateLinks?: boolean },
    ) =>
      request<SavedEntry>(`/admin/collections/${collection}/entries/${slug}`, {
        method: "PUT",
        body,
      }),
    /** `revision`: the entry as the editor saw it. A later save by a colleague is a conflict. */
    remove: (collection: string, slug: string, revision: string) =>
      request<{ ok: true }>(`/admin/collections/${collection}/entries/${slug}`, {
        method: "DELETE",
        query: { revision },
      }),
    /** `revision`: the order the editor saw, null without an order file. */
    reorder: (collection: string, slugs: string[], revision: string | null) =>
      request<{ ok: true; revision: string }>(`/admin/collections/${collection}/reorder`, {
        method: "POST",
        body: { slugs, revision },
      }),
    suggestSlug: (collection: string, source: string, except?: string) =>
      request<{ slug: string }>(`/admin/collections/${collection}/slug`, {
        query: { source, except },
      }),
    references: (collection: string, slug: string) =>
      request<{ references: Referrer[] }>(
        `/admin/collections/${collection}/entries/${slug}/references`,
      ),
  },

  singletons: {
    get: (name: string) => request<SingletonDetail>(`/admin/singletons/${name}`),
    save: (name: string, data: unknown, revision?: string | null, keepMine?: boolean) =>
      request<{ revision: string }>(`/admin/singletons/${name}`, {
        method: "PUT",
        body: { data, revision, ...(keepMine ? { keepMine } : {}) },
      }),
  },

  staging: {
    changes: () => request<StagingStatus>("/admin/changes"),
    /** `paths`: the reviewed paths, each with the revision the editor saw. */
    publish: (message: string, paths: Record<string, string | null>) =>
      request<PublishOutcome>("/admin/publish", {
        method: "POST",
        body: { message, paths },
      }),
    /** Brings Mica's clone up to date now. */
    sync: () => request<StagingStatus>("/admin/sync", { method: "POST" }),
    resolve: (group: string, choice: "mine" | "website") =>
      request<StagingStatus>("/admin/changes/resolve", {
        method: "POST",
        body: { group, choice },
      }),
    /** Retries the push after `committed-pending-push`. Never commits again. */
    push: () => request<PublishOutcome>("/admin/publish/push", { method: "POST" }),
    /** `paths`: the reviewed paths, each with the revision the editor saw, as for Publish. */
    discard: (paths: Record<string, string | null>) =>
      request<{ discarded: string[] }>("/admin/changes/discard", {
        method: "POST",
        body: { paths },
      }),
    /** `origin` compares with the website's version, for a conflict. */
    compare: (target: CompareTarget, against: "head" | "origin" = "head") =>
      request<Comparison>(
        `/admin/changes/compare?${new URLSearchParams({
          ...(target as unknown as Record<string, string>),
          ...(against === "origin" ? { against } : {}),
        })}`,
      ),
  },

  media: {
    list: () => request<{ items: MediaItem[] }>("/admin/media"),
    /** One request for each file, one after another. */
    upload: async (files: File[], options: { accept?: string; directory?: string; newEntry?: boolean } = {}) => {
      const items: MediaItem[] = [];
      for (const file of files) {
        const query = {
          name: file.name,
          accept: options.accept,
          // Where the file goes in the repository. An entry's own `media/`
          // directory keeps the entry self-contained and its rename cheap.
          directory: options.directory,
          newEntry: options.newEntry ? "true" : undefined,
        };
        const result = await request<{ items: MediaItem[] }>("/admin/media", { method: "POST", body: file, query });
        items.push(...result.items);
      }
      return { items };
    },
    /** One file with its dimensions; the list leaves them out, so that the server reads no file for it. */
    info: (path: string) => request<MediaItem>("/admin/media/info", { query: { path } }),
    /** Where each file is used, in a media field or in rich text. */
    usage: (paths: string[]) =>
      request<{ uses: Record<string, Referrer[]>; unreadable: string[] }>("/admin/media/usage", { query: { path: paths } }),
    /** Deletes files that nothing uses. The delete waits on the Publish page like any change. */
    remove: (paths: string[]) =>
      request<{ deleted: string[] }>("/admin/media/delete", { method: "POST", body: { paths } }),
    /** Absolute URL for previewing a repository file inside the admin. */
    url: (path: string) =>
      `${BASE}/admin/media/file/${path.split("/").map(encodeURIComponent).join("/")}`,
  },
};

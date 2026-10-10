/**
 * Admin API client.
 *
 * Thin on purpose: one `request` function that attaches the CSRF header, parses
 * the error envelope the server sends, and surfaces field-level issues so forms
 * can place them next to the right input.
 */

import type { AnyField, FieldIssue } from "@micacms/core";

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

/** The CSRF cookie is readable by design — it is echoed back as a header. */
function csrfToken(): string {
  const match = /(?:^|;\s*)mica_csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {};
  const method = options.method ?? "GET";

  if (method !== "GET") headers["x-csrf-token"] = csrfToken();

  const isFormData = options.body instanceof FormData;
  if (options.body !== undefined && !isFormData) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      signal: options.signal,
      body: isFormData
        ? (options.body as FormData)
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : undefined,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "network_error", "Could not reach the server. Check your connection.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
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
}

export interface SchemaSingleton {
  name: string;
  label: string;
  description: string | null;
  fields: Record<string, AnyField>;
}

export interface Schema {
  collections: SchemaCollection[];
  singletons: SchemaSingleton[];
}

/**
 * Who the identity provider said this is.
 *
 * Null wherever there is no provider. Mica holds no accounts, so this is not a
 * record of anybody — it is what the last sign-in was told, kept only for as
 * long as the session, and there is nothing here to administer.
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

export interface EntryDetail extends EntrySummary {
  /**
   * Where the entry is in the repository, relative to the content root.
   *
   * A directory when the entry has rich text or media beside it, a single
   * `.json` file otherwise — which is why the server says so rather than the
   * editor guessing.
   */
  path: string;
  /**
   * The version of this entry the form was opened against.
   *
   * Sent back with the save. `null` means the entry did not exist, which is
   * what makes two people creating the same slug fail rather than one of them
   * silently losing their work.
   */
  revision: string | null;
}

export interface SavedEntry {
  slug: string;
  title: string;
  revision: string;
  /** True when the save moved the entry to a new slug. */
  renamed: boolean;
}

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
  updatedAt?: string;
  owner: ChangeOwner;
}

/** One thing that would make the pending set unpublishable. */
export interface StagingProblem {
  path: string;
  label: string;
  issues: FieldIssue[];
}

/**
 * The pending change set — what is Saved and not yet Published.
 *
 * `workspace` decides the words: a working tree is the developer's checkout
 * and publishing runs their own Git; a draft store lives in Mica and
 * publishing writes one commit through the provider.
 */
export interface StagingStatus {
  workspace: "working-tree" | "draft-store";
  publish: { enabled: boolean; reason?: string };
  /** What the pending changes are based on. Sent back with Publish. */
  baseRevision: string | null;
  branch: string | null;
  /** Commits created and not yet pushed. Working tree only. */
  ahead: number | null;
  /** File changes, not edits: count with `toEdits`, never with `.length`. */
  changes: FileChange[];
  validation: { ok: boolean; problems: StagingProblem[] };
  updatedAt: string | null;
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
    environment: string;
    node: string;
    platform: string;
    startedAt: string;
    uptimeSeconds: number;
  };
  schema: {
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
      /** Entries in the repository. A plain count: there are no drafts. */
      entries: number;
    }>;
    singletons: Array<{ name: string; label: string; fields: FieldCounts; depth: number }>;
  };
  /**
   * The website's content, and what must be backed up — by Git, which is
   * already doing it.
   */
  repository: {
    origin: string;
    entries: number;
    media: MediaUsage;
  };
  /**
   * The composition's operational state. Null in the local editor, which
   * keeps no database at all.
   */
  database: {
    path: string;
    sessions: number;
    version: number;
    bytes: number | null;
  } | null;
  deployment: {
    site: string;
    baseUrl: string;
    /** Where the content model was read from, e.g. `<repo>/.mica/schema.json`. */
    schemaOrigin: string;
    repositoryMode: "local" | "github" | "gitlab";
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
    generatedSecrets: string[];
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
     * Sign-in is a full-page navigation, not a fetch.
     *
     * The browser has to *visit* the identity provider — it is another origin
     * that will set its own cookies and may need to show a consent screen or a
     * second factor. An XHR cannot do any of that.
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
      request<{ items: EntrySummary[]; total: number }>(
        `/admin/collections/${collection}/entries`,
        { query },
      ),
    get: (collection: string, slug: string) =>
      request<EntryDetail>(`/admin/collections/${collection}/entries/${slug}`),
    create: (collection: string, body: { data: unknown; revision?: string | null }) =>
      request<SavedEntry>(`/admin/collections/${collection}/entries`, { method: "POST", body }),
    update: (collection: string, slug: string, body: { data: unknown; revision?: string | null }) =>
      request<SavedEntry>(`/admin/collections/${collection}/entries/${slug}`, {
        method: "PUT",
        body,
      }),
    remove: (collection: string, slug: string) =>
      request<{ ok: true }>(`/admin/collections/${collection}/entries/${slug}`, {
        method: "DELETE",
      }),
    reorder: (collection: string, slugs: string[]) =>
      request<{ ok: true }>(`/admin/collections/${collection}/reorder`, {
        method: "POST",
        body: { slugs },
      }),
    suggestSlug: (collection: string, source: string, except?: string) =>
      request<{ slug: string }>(`/admin/collections/${collection}/slug`, {
        query: { source, except },
      }),
    references: (collection: string, slug: string) =>
      request<{ references: Array<{ collection: string; title: string; slug: string }> }>(
        `/admin/collections/${collection}/entries/${slug}/references`,
      ),
  },

  singletons: {
    get: (name: string) => request<SingletonDetail>(`/admin/singletons/${name}`),
    save: (name: string, data: unknown, revision?: string | null) =>
      request<{ revision: string }>(`/admin/singletons/${name}`, {
        method: "PUT",
        body: { data, revision },
      }),
  },

  staging: {
    changes: () => request<StagingStatus>("/admin/changes"),
    publish: (message: string, expectedBase: string | null) =>
      request<PublishOutcome>("/admin/publish", {
        method: "POST",
        body: { message, expectedBase },
      }),
    /** Retries the push after `committed-pending-push`. Never commits again. */
    push: () => request<PublishOutcome>("/admin/publish/push", { method: "POST" }),
    discard: (paths: string[]) =>
      request<{ discarded: string[] }>("/admin/changes/discard", {
        method: "POST",
        body: { paths },
      }),
    compare: (target: CompareTarget) =>
      request<Comparison>(
        `/admin/changes/compare?${new URLSearchParams(target as unknown as Record<string, string>)}`,
      ),
  },

  media: {
    list: () => request<{ items: MediaItem[] }>("/admin/media"),
    upload: (files: File[], options: { accept?: string; directory?: string } = {}) => {
      const form = new FormData();
      for (const file of files) form.append("file", file);
      if (options.accept) form.append("accept", options.accept);
      // Where the file goes in the repository. An entry's own `media/`
      // directory keeps the entry self-contained and its rename cheap.
      if (options.directory) form.append("directory", options.directory);
      return request<{ items: MediaItem[] }>("/admin/media", { method: "POST", body: form });
    },
    /** Absolute URL for previewing a repository file inside the admin. */
    url: (path: string) =>
      `${BASE}/admin/media/file/${path.split("/").map(encodeURIComponent).join("/")}`,
  },
};

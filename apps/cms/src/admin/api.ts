/**
 * Admin API client.
 *
 * Thin on purpose: one `request` function that attaches the CSRF header, parses
 * the error envelope the server sends, and surfaces field-level issues so forms
 * can place them next to the right input.
 */

import type { AnyField, EntryStatus, FieldIssue, MediaRef } from "@micacms/model";

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

export interface SchemaGlobal {
  name: string;
  label: string;
  description: string | null;
  fields: Record<string, AnyField>;
}

export interface Schema {
  collections: SchemaCollection[];
  globals: SchemaGlobal[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor";
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
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
  data: Record<string, unknown>;
  revision: string | null;
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
  users: number;
  repository: string;
}

export interface FieldCounts {
  /** Fields declared directly on the collection or singleton. */
  top: number;
  /** Every field, including those nested in objects and repeaters. */
  total: number;
  required: number;
}

export interface EntryCounts {
  total: number;
  drafts: number;
  published: number;
}

/** Everything the System view shows. `deployment` is null for editors. */
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
    fingerprint: string;
    contentVersion: string;
    totals: FieldCounts & { collections: number; globals: number };
    kinds: Array<{ kind: string; count: number }>;
    relations: Array<{
      from: string;
      fromType: "collection" | "global";
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
      entries: EntryCounts;
    }>;
    globals: Array<{ name: string; label: string; fields: FieldCounts; depth: number }>;
  };
  storage: {
    entries: EntryCounts;
    revisions: number;
    users: number;
    database: { version: number; bytes: number | null };
    media: { files: number; bytes: number; readable: string };
  };
  deployment: {
    baseUrl: string;
    schemaPath: string;
    dataDir: string;
    databasePath: string;
    mediaDir: string;
    logLevel: string;
    maxUploadBytes: number;
    maxUploadReadable: string;
    sessionTtlHours: number;
    sessionIdleHours: number;
    publishDebounceMs: number;
    trustProxy: boolean;
    cookieSecure: boolean;
    adminOrigins: string[];
    buildWebhookConfigured: boolean;
    buildWebhookSigned: boolean;
    generatedSecrets: string[];
    memoryBytes: number;
  } | null;
}

/* ------------------------------------------------------------------ *
 * Endpoints
 * ------------------------------------------------------------------ */

export const api = {
  auth: {
    me: () => request<{ user: AdminUser; csrfToken: string }>("/auth/me"),
    login: (email: string, password: string) =>
      request<{ user: AdminUser; csrfToken: string }>("/auth/login", {
        method: "POST",
        body: { email, password },
      }),
    logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>("/auth/password", {
        method: "POST",
        body: { currentPassword, newPassword },
      }),
  },

  schema: () => request<Schema>("/admin/schema"),
  overview: () => request<Overview>("/admin/overview"),
  system: () => request<SystemInfo>("/admin/system"),
  publish: () => request<{ ok: true }>("/admin/publish", { method: "POST" }),

  entries: {
    list: (collection: string, query: RequestOptions["query"] = {}) =>
      request<{ items: EntrySummary[]; total: number }>(
        `/admin/collections/${collection}/entries`,
        { query },
      ),
    get: (collection: string, slug: string) =>
      request<EntryDetail>(`/admin/collections/${collection}/entries/${slug}`),
    create: (collection: string, body: { data: unknown; revision?: string | null }) =>
      request<EntryDetail>(`/admin/collections/${collection}/entries`, { method: "POST", body }),
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

  users: {
    list: () => request<{ users: AdminUser[] }>("/admin/users"),
    create: (body: { email: string; name: string; role: string; password: string }) =>
      request<{ user: AdminUser }>("/admin/users", { method: "POST", body }),
    update: (id: string, body: { email?: string; name?: string; role?: string }) =>
      request<{ user: AdminUser }>(`/admin/users/${id}`, { method: "PATCH", body }),
    setPassword: (id: string, password: string) =>
      request<{ ok: true }>(`/admin/users/${id}/password`, { method: "POST", body: { password } }),
    remove: (id: string) => request<{ ok: true }>(`/admin/users/${id}`, { method: "DELETE" }),
  },
};

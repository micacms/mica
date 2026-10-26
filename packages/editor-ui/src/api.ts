/**
 * Admin API client: one `request` function that attaches the CSRF header and
 * surfaces field-level issues for forms. The response shapes are the
 * runtime's own types, imported as types only: nothing of the server is in
 * the bundle.
 */

import type { FieldIssue, PublishResult, UnreadableEntry } from "@micacms/core/internal";
import type {
  AnnotatedChange,
  ChangeOwner,
  ChangesResponse,
  CompareManyResponse,
  CompareTarget,
  Comparison,
  EntryDetail,
  EntrySummary,
  MediaFile,
  Overview,
  PreviewStatus,
  ProblemLine,
  Referrer,
  SavedEntry,
  Schema,
  SchemaCollection,
  SchemaReferenceSet,
  SchemaSingleton,
  SchemaSite,
  SingletonDetail,
  StagingProblem,
  SyncConflict,
  SyncStatus,
  SystemInfo,
} from "@micacms/runtime";

export type {
  UnreadableEntry,
  ChangeOwner,
  CompareTarget,
  Comparison,
  EntryDetail,
  EntrySummary,
  Overview,
  PreviewStatus,
  ProblemLine,
  Referrer,
  SavedEntry,
  Schema,
  SchemaCollection,
  SchemaReferenceSet,
  SchemaSingleton,
  SchemaSite,
  SingletonDetail,
  StagingProblem,
  SyncConflict,
  SystemInfo,
};

/** One path the publication writes or deletes, with the edit it belongs to. See `lib/edits.ts` for the unit an editor sees. */
export type FileChange = AnnotatedChange;

/** The pending change set — what is Saved and not yet Published — and the model the server checks it with. */
export type StagingStatus = ChangesResponse;

export type PublishOutcome = PublishResult;

/** A file in the content repository. */
export type MediaItem = MediaFile;

const BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: FieldIssue[];
  /** The server's id of the request, which its log names too. */
  readonly requestId: string | null;

  constructor(status: number, code: string, message: string, issues: FieldIssue[] = [], requestId: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.requestId = requestId;
  }

  /** True when the session has gone; the shell reacts by showing the sign-in view. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/**
 * What to tell the editor about a failure: the server's words, or `fallback` for anything else.
 * A server failure also gives its request ID, so that the person who runs Mica finds it in the log.
 */
export function messageOf(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  return error.status >= 500 && error.requestId ? `${error.message} Reference: ${error.requestId}.` : error.message;
}

/** The CSRF cookie is readable by design — it is echoed back as a header. `__Host-` over https. */
function csrfToken(): string {
  const match = /(?:^|;\s*)(?:__Host-)?mica_csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** A list repeats the parameter: `?path=a&path=b`. */
  query?: Record<string, string | number | boolean | string[] | undefined>;
  signal?: AbortSignal;
}

let onUnauthenticated: (() => void) | null = null;
let onSessionExpiry: ((at: string) => void) | null = null;
let onModelUnreadable: (() => void) | null = null;

/** Called on every 401, so that the shell can say that the session ended. */
export function whenUnauthenticated(handler: () => void): void {
  onUnauthenticated = handler;
}

/** Called with the session's end from each response that names it. */
export function whenSessionExpiry(handler: (at: string) => void): void {
  onSessionExpiry = handler;
}

/** Called when the server refuses a write because it cannot read a newer content model, so that Save and Publish can say why. */
export function whenModelUnreadable(handler: () => void): void {
  onModelUnreadable = handler;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
  if (response.status === 401) onUnauthenticated?.();

  try {
    return await readResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiError && error.code === "model_unreadable") onModelUnreadable?.();
    throw error;
  }
}

/**
 * The body of a response, or the `ApiError` of a refusal. The status comes
 * first, and only a JSON response is read as JSON: a proxy in front of Mica
 * can answer with an HTML page, such as a 413 for a large upload.
 */
export async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const envelope = isJson(response) ? ((await response.json().catch(() => null)) as ErrorEnvelope | null) : null;
    const error = envelope?.error;
    const requestId = error?.requestId ?? response.headers.get("x-request-id");
    throw new ApiError(response.status, error?.code ?? "error", error?.message ?? statusMessage(response.status), error?.issues ?? [], requestId);
  }
  if (response.status === 204) return undefined as T;
  if (!isJson(response)) throw unreadable(response.status);
  try {
    return (await response.json()) as T;
  } catch {
    throw unreadable(response.status);
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; issues?: FieldIssue[]; requestId?: string };
}

const isJson = (response: Response): boolean => /[/+]json\b/.test(response.headers.get("content-type") ?? "");

const unreadable = (status: number) => new ApiError(status, "unreadable_response", "The server sent an answer that the editor cannot read. Try again.");

/** Words for a refusal without Mica's own message, such as one from a proxy. */
function statusMessage(status: number): string {
  if (status === 401) return "Your session has ended. Sign in again.";
  if (status === 413) return "This is too large for the server. Try a smaller file.";
  if (status === 502 || status === 503 || status === 504) return "The server cannot be reached just now. Try again in a moment.";
  return `The request failed (${status}). Try again.`;
}

/* ------------------------------------------------------------------ *
 * Editor-only shapes: the auth surface answers these, not the runtime
 * ------------------------------------------------------------------ */

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
  /** The id and title of each item of a reference set. */
  references: (name: string) => request<{ items: Array<{ id: string; title: string }> }>(`/admin/references/${encodeURIComponent(name)}`),
  /** The dev server that shows the drafts, or null: only the local editor, while `astro dev` runs. */
  preview: () => request<PreviewStatus & { handover: string | null }>("/admin/preview"),

  entries: {
    list: (collection: string) =>
      request<{ items: EntrySummary[]; total: number; unreadable: UnreadableEntry[]; orderRevision: string | null }>(
        `/admin/collections/${collection}/entries`,
      ),
    get: (collection: string, id: string) =>
      request<EntryDetail>(`/admin/collections/${collection}/entries/${id}`),
    create: (collection: string, body: { data: unknown; revision?: string | null }) =>
      request<SavedEntry>(`/admin/collections/${collection}/entries`, { method: "POST", body }),
    /** `keepMine`: the editor saw a newer save and chose to save over it. */
    update: (
      collection: string,
      id: string,
      body: { data: unknown; revision?: string | null; keepMine?: boolean; updateLinks?: boolean },
    ) =>
      request<SavedEntry>(`/admin/collections/${collection}/entries/${id}`, {
        method: "PUT",
        body,
      }),
    /** `revision`: the entry as the editor saw it. A later save by a colleague is a conflict. */
    remove: (collection: string, id: string, revision: string) =>
      request<{ ok: true }>(`/admin/collections/${collection}/entries/${id}`, {
        method: "DELETE",
        query: { revision },
      }),
    /** `revision`: the order the editor saw, null without an order file. */
    reorder: (collection: string, ids: string[], revision: string | null) =>
      request<{ ok: true; revision: string }>(`/admin/collections/${collection}/reorder`, {
        method: "POST",
        body: { ids, revision },
      }),
    suggestId: (collection: string, source: string, except?: string) =>
      request<{ id: string }>(`/admin/collections/${collection}/id`, {
        query: { source, except },
      }),
    references: (collection: string, id: string) =>
      request<{ references: Referrer[] }>(
        `/admin/collections/${collection}/entries/${id}/references`,
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
    /** `compare` for up to 25 documents in one request, in their order: each a comparison or an error. A read, so a GET. */
    compareMany: (targets: CompareTarget[], against: "head" | "origin" = "head") =>
      request<CompareManyResponse>(
        `/admin/changes/compare?${new URLSearchParams({
          targets: JSON.stringify(targets),
          ...(against === "origin" ? { against } : {}),
        })}`,
      ).then((result) => result.comparisons),
  },

  media: {
    list: () => request<{ items: MediaItem[] }>("/admin/media"),
    /** One file. `uploadEach` of `@/lib/uploads` sends many, one after another. */
    uploadOne: async (file: File, options: { accept?: string; directory?: string; newEntry?: boolean } = {}) => {
      const query = {
        name: file.name,
        accept: options.accept,
        // Where the file goes in the repository. An entry's own `media/`
        // directory keeps the entry self-contained and its rename cheap.
        directory: options.directory,
        newEntry: options.newEntry ? "true" : undefined,
      };
      const result = await request<{ items: MediaItem[] }>("/admin/media", { method: "POST", body: file, query });
      return result.items[0]!;
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

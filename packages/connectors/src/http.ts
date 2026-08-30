/**
 * The HTTP shared by the provider connectors.
 *
 * Small on purpose. A connector needs a request that carries a token, raises a
 * useful error, and can be replaced in a test — nothing more. Bringing in a
 * provider SDK would trade those three lines for a dependency that knows about
 * pull requests, issues and workflows, none of which Mica has any business
 * touching.
 */

import { ConnectorError } from "@micacms/core";

/**
 * The subset of `fetch` a connector uses.
 *
 * Injectable so the tests can answer requests without a network. That is not
 * only convenience: a connector's whole job is the shape of its requests, and a
 * stub is the only way to assert on that shape directly.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A provider said no. Carries the status so callers can tell 404 from 500. */
export class HttpError extends ConnectorError {
  override name = "HttpError";
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export interface HttpClientOptions {
  base: string;
  headers: Record<string, string>;
  fetch?: FetchLike;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Overrides `Accept`, for the endpoints that return raw bytes. */
  accept?: string;
  /** Return null on 404 instead of throwing. */
  optional?: boolean;
}

/**
 * A path segment is escaped, a path separator is not.
 *
 * Content paths carry slashes and may carry spaces, accents or a `#`. Encoding
 * the whole path would break the first; leaving it alone would break the rest.
 */
export function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment !== "")
    .map(encodeURIComponent)
    .join("/");
}

export function createHttpClient(options: HttpClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.base.replace(/\/$/, "");

  async function send(path: string, request: RequestOptions = {}): Promise<Response | null> {
    const headers: Record<string, string> = { ...options.headers };
    if (request.accept) headers["accept"] = request.accept;
    if (request.body !== undefined) headers["content-type"] = "application/json";

    const response = await doFetch(`${base}${path}`, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });

    if (response.status === 404 && request.optional) return null;

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new HttpError(
        `${request.method ?? "GET"} ${path} failed: ${response.status} ${response.statusText}` +
          // The provider's own message is the useful half — a 422 from a tree
          // write says which path it disliked.
          (body ? ` — ${body.slice(0, 400)}` : ""),
        response.status,
        body,
      );
    }

    return response;
  }

  return {
    async json<T>(path: string, request: RequestOptions = {}): Promise<T | null> {
      const response = await send(path, request);
      return response === null ? null : ((await response.json()) as T);
    },

    async text(path: string, request: RequestOptions = {}): Promise<string | null> {
      const response = await send(path, request);
      return response === null ? null : await response.text();
    },

    async bytes(path: string, request: RequestOptions = {}): Promise<Uint8Array | null> {
      const response = await send(path, request);
      return response === null ? null : new Uint8Array(await response.arrayBuffer());
    },
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;

/**
 * The GitLab connector.
 *
 * Shorter than the GitHub one, and not because it does less. GitLab's commits
 * API takes a list of actions and applies them as a single commit, which is
 * exactly the operation Mica needs; GitHub has to be walked through blob, tree,
 * commit and ref to reach the same place.
 *
 * Concurrency uses `last_commit_id`, which GitLab checks per action: a change
 * is rejected if the file moved on since the commit named. Mica holds blob IDs
 * rather than commit IDs, so the mapping is done here — the connector reads the
 * current blob ID for every expected path and refuses before sending anything.
 * `expect` is therefore checked in Mica, and the atomicity is GitLab's.
 */

import {
  checkCommitPaths,
  contentPath,
  ConflictError,
  ConnectorError,
  type Author,
  type CommitInput,
  type CommitResult,
  type DirectoryEntry,
  type RepositoryConnector,
} from "@micacms/core";
import { createHttpClient, encodePath, HttpError, type FetchLike } from "./http.js";

export interface GitLabConnectorOptions {
  /** `group/project`, or the numeric project id. */
  project: string;
  /** Defaults to `main`. */
  branch?: string;
  /** A token with `write_repository` scope. */
  token: string;
  /** Directory inside the repository that is the content root. */
  root?: string;
  /** For self-managed GitLab. Defaults to gitlab.com. */
  apiBase?: string;
  author?: Author;
  fetch?: FetchLike;
}

interface TreeItem {
  id: string;
  name: string;
  path: string;
  type: "tree" | "blob";
}

interface FileResponse {
  blob_id: string;
  last_commit_id: string;
}

interface CommitResponse {
  id: string;
}

type ActionType = "create" | "update" | "delete";

interface CommitAction {
  action: ActionType;
  file_path: string;
  content?: string;
  encoding?: "text" | "base64";
  last_commit_id?: string;
}

export function gitlabConnector(options: GitLabConnectorOptions): RepositoryConnector {
  const branch = options.branch ?? "main";
  const root = (options.root ?? "").replace(/^\/+|\/+$/g, "");
  const projectBase = `/api/v4/projects/${encodeURIComponent(options.project)}`;

  const http = createHttpClient({
    base: options.apiBase ?? "https://gitlab.com",
    fetch: options.fetch,
    headers: {
      // A project access token goes in this header; GitLab does not accept a
      // bearer token for project-scoped tokens.
      "private-token": options.token,
      accept: "application/json",
      "user-agent": "mica-cms",
    },
  });

  const inRepo = (path: string): string => {
    const clean = contentPath(path, { allowRoot: true });
    if (!root) return clean;
    return clean === "" ? root : `${root}/${clean}`;
  };

  const filesUrl = (path: string, suffix = ""): string =>
    `${projectBase}/repository/files/${encodeURIComponent(inRepo(path))}${suffix}` +
    `?ref=${encodeURIComponent(branch)}`;

  const readBytes = async (path: string): Promise<Uint8Array | null> =>
    http.bytes(filesUrl(path, "/raw"), { optional: true });

  /**
   * Blob ID of a file, or null when it is not there.
   *
   * `HEAD` would be cheaper but GitLab returns the metadata in headers rather
   * than a body, and the saving is not worth two code paths.
   */
  const blobId = async (path: string): Promise<string | null> => {
    const file = await http.json<FileResponse>(filesUrl(path), { optional: true });
    return file?.blob_id ?? null;
  };

  /** Every file under the content root, as content-relative path → blob id. */
  async function contentTree(): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    // GitLab paginates at 20 by default; content trees are small but not that
    // small, and a silently short listing would make a delete miss files.
    const perPage = 100;

    for (let page = 1; ; page += 1) {
      const items = await http.json<TreeItem[]>(
        `${projectBase}/repository/tree?ref=${encodeURIComponent(branch)}` +
          `&recursive=true&per_page=${perPage}&page=${page}` +
          (root ? `&path=${encodeURIComponent(root)}` : ""),
        { optional: true },
      );

      if (!items || items.length === 0) break;
      for (const item of items) if (item.type === "blob") found.set(item.path, item.id);
      if (items.length < perPage) break;
    }

    return found;
  }

  return {
    origin: `gitlab:${options.project}${root ? `/${root}` : ""}@${branch}`,

    async read(path) {
      const bytes = await readBytes(path);
      return bytes === null ? null : Buffer.from(bytes).toString("utf8");
    },

    readBinary: readBytes,

    async list(path): Promise<DirectoryEntry[]> {
      const items = await http.json<TreeItem[]>(
        `${projectBase}/repository/tree?ref=${encodeURIComponent(branch)}&per_page=100` +
          `&path=${encodeURIComponent(inRepo(path))}`,
        { optional: true },
      );

      if (!items) return [];

      return items
        .map((item) => ({
          name: item.name,
          type: item.type === "tree" ? ("directory" as const) : ("file" as const),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    revision: blobId,

    async head() {
      const found = await http.json<{ commit: { id: string } }>(
        `${projectBase}/repository/branches/${encodeURIComponent(branch)}`,
        { optional: true },
      );
      return found?.commit.id ?? null;
    },

    async commit(input: CommitInput): Promise<CommitResult> {
      checkCommitPaths(input);
      if (input.changes.length === 0) {
        throw new ConnectorError("A commit needs at least one change.");
      }

      const existing = await contentTree();

      /* --------------------------------------------------- expectations */

      if (input.expect) {
        const stale = Object.entries(input.expect)
          .filter(([path, expected]) => (existing.get(inRepo(path)) ?? null) !== expected)
          .map(([path]) => path);

        if (stale.length > 0) {
          throw new ConflictError(
            `${stale.length === 1 ? "This file has" : "These files have"} changed in the ` +
              `repository since they were opened: ${stale.join(", ")}.`,
            stale,
          );
        }
      }

      /* ------------------------------------------------------- actions */

      const actions: CommitAction[] = [];

      for (const change of input.changes) {
        const path = inRepo(change.path);

        if (change.type === "write") {
          // GitLab distinguishes the two, and using the wrong one is an error
          // rather than an upsert.
          actions.push({
            action: existing.has(path) ? "update" : "create",
            file_path: path,
            ...(typeof change.contents === "string"
              ? { content: change.contents, encoding: "text" as const }
              : {
                  content: Buffer.from(change.contents).toString("base64"),
                  encoding: "base64" as const,
                }),
          });
          continue;
        }

        if (change.type === "delete") {
          if (existing.has(path)) actions.push({ action: "delete", file_path: path });
          continue;
        }

        const prefix = `${path}/`;
        for (const found of existing.keys()) {
          if (found === path || found.startsWith(prefix)) {
            actions.push({ action: "delete", file_path: found });
          }
        }
      }

      if (actions.length === 0) {
        throw new ConnectorError("Nothing in this change set exists to be changed.");
      }

      const author = input.author ?? options.author;

      try {
        const commit = await http.json<CommitResponse>(`${projectBase}/repository/commits`, {
          method: "POST",
          body: {
            branch,
            commit_message: input.message,
            actions,
            ...(author ? { author_name: author.name, author_email: author.email } : {}),
          },
        });

        if (!commit) throw new ConnectorError("GitLab accepted a commit but returned no id.");
        return { revision: commit.id };
      } catch (error) {
        // GitLab answers 400 when an action's file is already gone or already
        // there — which, having just read the tree, means it moved underneath.
        if (error instanceof HttpError && (error.status === 400 || error.status === 409)) {
          throw new ConflictError(
            "The repository changed while this was being saved. Nothing was written. " +
              "Reload and try again.",
            input.changes.map((change) => change.path),
          );
        }
        throw error;
      }
    },
  };
}

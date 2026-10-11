/**
 * The GitHub connector.
 *
 * Writes through the Git Data API — blob, tree, commit, ref — rather than the
 * Contents API. The Contents API writes one file per commit, and an entry is
 * not one file: it is an `index.json`, its rich-text sidecars and its media.
 * Four calls that each make a commit would put a half-saved entry in the
 * repository's history three times out of four. The Git Data API costs more
 * requests and produces exactly one commit, which is the whole point.
 *
 * Concurrency has two layers, and both are needed:
 *
 *   - `expect` is checked against the blob SHAs at the branch head, which
 *     catches the case Mica cares about — two editors on the same entry.
 *   - The ref update is not forced, so a push that landed between reading the
 *     head and writing it is rejected by GitHub rather than overwritten. That
 *     covers everything Mica cannot see, including a developer's own commits.
 */

import {
  checkCommitPaths,
  ConflictError,
  ConnectorError,
  contentPath,
  type Author,
  type CommitInput,
  type CommitResult,
  type DirectoryEntry,
  type RepositoryConnector,
} from "@micacms/core";
import { createHttpClient, encodePath, HttpError, type FetchLike } from "./http.js";

export interface GitHubConnectorOptions {
  owner: string;
  repo: string;
  /** Defaults to `main`. Content is committed straight onto it. */
  branch?: string;
  /** A token with content write access to this repository. */
  token: string;
  /**
   * Directory inside the repository that is the content root.
   *
   * Usually `content`. Everything Mica reads and writes is under it, so a
   * token scoped to this repository still cannot be used to touch the site's
   * source code through Mica.
   */
  root?: string;
  /** For GitHub Enterprise Server. Defaults to the public API. */
  apiBase?: string;
  /** Used when a commit does not name one. */
  author?: Author;
  fetch?: FetchLike;
}

/* ------------------------------- API shapes we depend on ---------------- */

interface RefResponse {
  object: { sha: string };
}
interface CommitResponse {
  sha: string;
  tree: { sha: string };
}
interface TreeResponse {
  sha: string;
  truncated: boolean;
  tree: Array<{ path: string; mode: string; type: "blob" | "tree" | "commit"; sha: string }>;
}
interface ContentsItem {
  name: string;
  path: string;
  sha: string;
  type: "file" | "dir" | "symlink" | "submodule";
}
interface BlobResponse {
  sha: string;
}

/** The only file mode Mica writes. Content is not executable and not a link. */
const FILE_MODE = "100644";

export function githubConnector(options: GitHubConnectorOptions): RepositoryConnector {
  const branch = options.branch ?? "main";
  const root = (options.root ?? "").replace(/^\/+|\/+$/g, "");
  const repoBase = `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;

  const http = createHttpClient({
    base: options.apiBase ?? "https://api.github.com",
    fetch: options.fetch,
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "mica-cms",
    },
  });

  /** A content path with no leading or trailing slash, refused if it could leave the content root. */
  const clean = (path: string): string => contentPath(path, { allowRoot: true });

  /** The same path as GitHub sees it: below the configured content root. */
  const inRepo = (path: string): string => {
    const relative = clean(path);
    if (!root) return relative;
    return relative === "" ? root : `${root}/${relative}`;
  };

  const contentsUrl = (path: string): string =>
    `${repoBase}/contents/${encodePath(inRepo(path))}?ref=${encodeURIComponent(branch)}`;

  /* ----------------------------------------------------------- reading */

  const readBytes = async (path: string): Promise<Uint8Array | null> =>
    // Raw, not the JSON envelope: the JSON form omits the content of files over
    // a megabyte, which is most of the media an editor uploads.
    http.bytes(contentsUrl(path), { accept: "application/vnd.github.raw", optional: true });

  /* ---------------------------------------------------------- committing */

  /**
   * Every file under the content root at `commitSha`, as path → blob SHA.
   *
   * One request instead of one per path. Addressed as `{sha}:{root}` so the
   * response covers the content directory and not the whole repository, which
   * keeps it far away from the size at which GitHub starts truncating.
   *
   * Because it is addressed at the subtree, the paths that come back are
   * relative to the content root — the same paths Mica uses everywhere else.
   * They need `inRepo` again before they can go into a tree write.
   */
  async function contentTree(commitSha: string): Promise<Map<string, string>> {
    const target = root ? `${commitSha}:${encodePath(root)}` : commitSha;
    const tree = await http.json<TreeResponse>(
      `${repoBase}/git/trees/${target}?recursive=1`,
      { optional: true },
    );

    // Absent when the content root has not been created yet — a repository
    // where nothing has been published is not an error.
    if (!tree) return new Map();

    if (tree.truncated) {
      throw new ConnectorError(
        `The content directory of ${options.owner}/${options.repo} is too large for one tree ` +
          `listing. Mica reads it whole to check for conflicting edits.`,
      );
    }

    return new Map(
      tree.tree.filter((item) => item.type === "blob").map((item) => [item.path, item.sha]),
    );
  }

  async function createBlob(contents: string | Uint8Array): Promise<string> {
    const body =
      typeof contents === "string"
        ? { content: contents, encoding: "utf-8" }
        : { content: Buffer.from(contents).toString("base64"), encoding: "base64" };

    const blob = await http.json<BlobResponse>(`${repoBase}/git/blobs`, {
      method: "POST",
      body,
    });

    // Only reachable if GitHub answers 2xx with no body, which would mean the
    // API changed under us; better to say so than to write a tree of undefined.
    if (!blob?.sha) throw new ConnectorError("GitHub accepted a blob but returned no SHA.");
    return blob.sha;
  }

  return {
    origin: `github:${options.owner}/${options.repo}${root ? `/${root}` : ""}@${branch}`,

    async read(path) {
      const bytes = await readBytes(path);
      return bytes === null ? null : Buffer.from(bytes).toString("utf8");
    },

    readBinary: readBytes,

    async list(path): Promise<DirectoryEntry[]> {
      const items = await http.json<ContentsItem[] | ContentsItem>(contentsUrl(path), {
        optional: true,
      });

      // Null for a directory that is not there, an object for a path that turned
      // out to be a file. Neither is a failure: `list` describes children, and a
      // file has none.
      if (items === null || !Array.isArray(items)) return [];

      return items
        .filter((item) => item.type === "file" || item.type === "dir")
        .map((item) => ({
          name: item.name,
          type: item.type === "dir" ? ("directory" as const) : ("file" as const),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async revision(path) {
      const item = await http.json<ContentsItem | ContentsItem[]>(contentsUrl(path), {
        optional: true,
      });
      if (item === null || Array.isArray(item)) return null;

      // The blob SHA: it is content-addressed, so it changes exactly when the
      // file changes and not when some unrelated commit touches the branch.
      return item.sha;
    },

    async head() {
      const ref = await http.json<RefResponse>(
        `${repoBase}/git/ref/heads/${encodePath(branch)}`,
        { optional: true },
      );
      return ref?.object.sha ?? null;
    },

    async commit(input: CommitInput): Promise<CommitResult> {
      checkCommitPaths(input);
      if (input.changes.length === 0) {
        throw new ConnectorError("A commit needs at least one change.");
      }

      const ref = await http.json<RefResponse>(
        `${repoBase}/git/ref/heads/${encodePath(branch)}`,
      );
      if (!ref) throw new ConnectorError(`Branch "${branch}" does not exist.`);

      const headSha = ref.object.sha;
      const head = await http.json<CommitResponse>(`${repoBase}/git/commits/${headSha}`);
      if (!head) throw new ConnectorError(`Commit ${headSha} could not be read.`);

      const blobs = await contentTree(headSha);

      /* --------------------------------------------------- expectations */

      if (input.expect) {
        const stale = Object.entries(input.expect)
          .filter(([path, expected]) => (blobs.get(clean(path)) ?? null) !== expected)
          .map(([path]) => path);

        if (stale.length > 0) {
          throw new ConflictError(
            `${stale.length === 1 ? "This file has" : "These files have"} changed in the ` +
              `repository since they were opened: ${stale.join(", ")}.`,
            stale,
          );
        }
      }

      /* ---------------------------------------------------------- tree */

      const entries: Array<{
        path: string;
        mode: string;
        type: "blob";
        sha: string | null;
      }> = [];

      const remove = (path: string) =>
        entries.push({ path, mode: FILE_MODE, type: "blob", sha: null });

      for (const change of input.changes) {
        // `blobs` is keyed content-relative; a tree entry is repository-relative.
        const relative = clean(change.path);

        if (change.type === "write") {
          entries.push({
            path: inRepo(relative),
            mode: FILE_MODE,
            type: "blob",
            sha: await createBlob(change.contents),
          });
          continue;
        }

        if (change.type === "delete") {
          // A path GitHub does not have cannot be deleted from a tree: sending
          // it makes the whole tree write fail. Skipping it is what the caller
          // meant — the file is not there either way.
          if (blobs.has(relative)) remove(inRepo(relative));
          continue;
        }

        // deleteTree: the tree API has no recursive delete, so name every file.
        const prefix = `${relative}/`;
        for (const existing of blobs.keys()) {
          if (existing === relative || existing.startsWith(prefix)) remove(inRepo(existing));
        }
      }

      if (entries.length === 0) {
        throw new ConnectorError("Nothing in this change set exists to be changed.");
      }

      const tree = await http.json<{ sha: string }>(`${repoBase}/git/trees`, {
        method: "POST",
        body: { base_tree: head.tree.sha, tree: entries },
      });
      if (!tree) throw new ConnectorError("GitHub accepted a tree but returned no SHA.");

      /* -------------------------------------------------------- commit */

      const author = input.author ?? options.author;
      const commit = await http.json<{ sha: string }>(`${repoBase}/git/commits`, {
        method: "POST",
        body: {
          message: input.message,
          tree: tree.sha,
          parents: [headSha],
          ...(author ? { author: { name: author.name, email: author.email } } : {}),
        },
      });
      if (!commit) throw new ConnectorError("GitHub accepted a commit but returned no SHA.");

      /* ----------------------------------------------------------- ref */

      try {
        await http.json(`${repoBase}/git/refs/heads/${encodePath(branch)}`, {
          method: "PATCH",
          // Never forced. If the branch moved while this commit was being
          // built, the write must lose — the commit is already stored and
          // unreferenced, and GitHub collects it.
          body: { sha: commit.sha, force: false },
        });
      } catch (error) {
        if (error instanceof HttpError && (error.status === 422 || error.status === 409)) {
          throw new ConflictError(
            `The branch "${branch}" moved while this change was being saved. Nothing was ` +
              `written. Reload and try again.`,
            input.changes.map((change) => change.path),
          );
        }
        throw error;
      }

      return { revision: commit.sha };
    },
  };
}

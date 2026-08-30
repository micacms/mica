/**
 * Where content files come from.
 *
 * Two methods wide on purpose. Everything above it — entry discovery, layout,
 * parsing — is written against `read` and `list` and nothing else, so one
 * reader serves a checked-out repository during an Astro build, a repository
 * connector answering from a provider API, and an in-memory fixture in a test.
 *
 * Nothing here touches a filesystem. `fileSystemSource` lives in
 * `@micacms/core/node`, because this module is also bundled into the browser.
 */

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory";
}

export interface ContentSource {
  /** A description of the origin, for error messages. */
  readonly origin: string;
  /** File contents as UTF-8 text, or null when there is no such file. */
  read(path: string): Promise<string | null>;
  /** Direct children of a directory; empty when the directory does not exist. */
  list(path: string): Promise<DirectoryEntry[]>;
}

export class ContentSourceError extends Error {
  override name = "ContentSourceError";
}

/**
 * A source built from a flat path-to-contents map, for tests and fixtures.
 *
 * Directories are inferred from the paths rather than declared, which keeps a
 * fixture down to the files it actually cares about.
 */
export function memorySource(files: Record<string, string>, origin = "memory"): ContentSource {
  const normalise = (path: string) => path.replace(/^\.?\//, "").replace(/\/$/, "");

  return {
    origin,

    async read(path) {
      return files[normalise(path)] ?? null;
    },

    async list(path) {
      const prefix = normalise(path) === "" ? "" : `${normalise(path)}/`;
      const seen = new Map<string, "file" | "directory">();

      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;

        const rest = key.slice(prefix.length);
        if (rest === "") continue;

        const slash = rest.indexOf("/");
        if (slash === -1) seen.set(rest, "file");
        else seen.set(rest.slice(0, slash), "directory");
      }

      return [...seen]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, type]) => ({ name, type }));
    },
  };
}

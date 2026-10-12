/**
 * Where content files come from. Only `read` and `list`, so one reader serves
 * an Astro build, the server's working tree and a test fixture.
 * `fileSystemSource` is in `@micacms/core/node`, because this module is also
 * bundled into the browser.
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

/** A content path that could leave the content root, or name it where a file is needed. */
export class ContentPathError extends ContentSourceError {
  override name = "ContentPathError";
}

// NUL, C0 and DEL: no provider or filesystem gives them a meaning Mica wants.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The check every source applies before a path reaches a filesystem. A leading
 * or trailing `/` is dropped; `.`, `..`, empty segments, `\`, control
 * characters and a drive letter are refused. The root itself (`""`) is only a
 * path for reading and listing.
 */
export function contentPath(path: string, options: { allowRoot?: boolean } = {}): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const refuse = (why: string): never => {
    throw new ContentPathError(`Content path "${path}" ${why}.`);
  };

  if (clean === "") return options.allowRoot ? "" : refuse("names the content root");
  if (path.includes("\\")) refuse("contains a backslash");
  if (CONTROL.test(path)) refuse("contains a control character");

  const segments = clean.split("/");
  if (/^[A-Za-z]:$/.test(segments[0]!)) refuse("starts with a drive letter");
  for (const segment of segments) {
    if (segment === "") refuse("contains an empty segment");
    if (segment === "." || segment === "..") refuse("contains a relative segment");
  }
  return clean;
}

/**
 * A source built from a flat path-to-contents map, for tests and fixtures.
 * Directories come from the paths.
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

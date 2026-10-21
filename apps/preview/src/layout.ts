/**
 * Where the website is in Mica's clone: the content root, the site's folder,
 * the lock file that installs it, and the commit that the clone is at.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** The file that the website's build writes into the content root, as Mica finds it. */
const MANIFEST = join(".mica", "schema.json");
const ASTRO_CONFIGS = ["mjs", "ts", "js", "mts", "cjs", "cts"].map((extension) => `astro.config.${extension}`);
/** Folders that hold no content root: Git's own, and installed packages. */
const NO_ROOT = new Set([".git", "node_modules"]);

/** A path in the repository, with `/` on every system. */
const portable = (path: string): string => path.split(sep).join("/");

/**
 * The content root, relative to the repository: `configured` (MICA_CONTENT_PATH),
 * else the one folder with `.mica/schema.json`, as Mica finds it. Null while
 * there is none, such as before Mica's first clone.
 */
export function contentRootIn(repository: string, configured?: string): string | null {
  // As Mica reads it: `/content/` is `content`.
  const named = configured?.replace(/^\/+|\/+$/g, "");
  if (named) return existsSync(join(repository, named, MANIFEST)) ? portable(named) : null;
  if (!existsSync(repository)) return null;
  const found: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || NO_ROOT.has(entry.name)) continue;
      const path = join(folder, entry.name);
      if (existsSync(join(path, MANIFEST))) found.push(portable(relative(repository, path)));
      else walk(path);
    }
  };
  walk(repository);
  if (found.length > 1) throw new Error(`The repository has more than one content root: ${found.join(", ")}. Set MICA_CONTENT_PATH to the one that Mica edits.`);
  return found[0] ?? null;
}

/**
 * The website's folder, relative to the repository: `configured`
 * (MICA_PREVIEW_SITE_PATH), else the nearest folder with an Astro config above
 * the content root.
 */
export function siteIn(repository: string, contentRoot: string, configured?: string): string {
  const hasConfig = (folder: string) => ASTRO_CONFIGS.some((name) => existsSync(join(repository, folder, name)));
  if (configured) {
    if (!hasConfig(configured)) throw new Error(`MICA_PREVIEW_SITE_PATH is ${configured}, but that folder has no astro.config.`);
    return portable(configured).replace(/\/$/, "");
  }
  for (let folder = dirname(contentRoot); ; folder = dirname(folder)) {
    const site = folder === "." ? "" : portable(folder);
    if (hasConfig(site)) return site;
    if (site === "") break;
  }
  throw new Error(
    `No folder above the content root ${contentRoot} has an astro.config. Set MICA_PREVIEW_SITE_PATH to the website's folder. ` +
      "With the content in a Git submodule, Mica's clone has no website: use an image of your own.",
  );
}

export type PackageManager = "npm" | "pnpm" | "yarn";

/** The lock file that installs the site: the nearest one at or above its folder, as a workspace has it at its root. */
export interface LockFile {
  manager: PackageManager;
  /** The folder of the lock file, relative to the repository: where the install runs. */
  folder: string;
  /** The lock file's name, or null for a site without one. */
  file: string | null;
  /** Yarn 2 or later, which has a `.yarnrc.yml`. */
  berry: boolean;
}

const LOCK_FILES: ReadonlyArray<[string, PackageManager]> = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
];

export function lockFileOf(repository: string, site: string): LockFile {
  for (let folder = site; ; folder = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "") {
    if (["bun.lock", "bun.lockb"].some((name) => existsSync(join(repository, folder, name)))) {
      throw new Error(`The site installs with Bun (${folder || "."}), which the preview image does not have. Use an image of your own.`);
    }
    for (const [file, manager] of LOCK_FILES) {
      if (existsSync(join(repository, folder, file))) return { manager, folder, file, berry: existsSync(join(repository, folder, ".yarnrc.yml")) };
    }
    if (folder === "") break;
  }
  return { manager: "npm", folder: site, file: null, berry: false };
}

/** What decides whether the packages must be installed again: the lock file and the manifest beside it. */
export function installKey(repository: string, lock: LockFile): string {
  const hash = createHash("sha256");
  for (const name of [lock.file, "package.json"]) {
    const path = name ? join(repository, lock.folder, name) : null;
    hash.update(path && existsSync(path) ? readFileSync(path) : "");
  }
  return hash.digest("hex");
}

/** The command that installs as the lock file asks, with each package manager's cache in `cache`. */
export function installCommand(lock: LockFile, cache: string): { command: string; args: string[]; env: Record<string, string> } {
  // Corepack's own download of pnpm or Yarn goes to the cache too.
  const env = { COREPACK_HOME: join(cache, "corepack"), COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
  switch (lock.manager) {
    case "pnpm":
      return { command: "corepack", args: ["pnpm", "install", "--frozen-lockfile", "--store-dir", join(cache, "pnpm")], env };
    case "yarn":
      return lock.berry
        ? { command: "corepack", args: ["yarn", "install", "--immutable"], env: { ...env, YARN_CACHE_FOLDER: join(cache, "yarn"), YARN_ENABLE_GLOBAL_CACHE: "false" } }
        : { command: "corepack", args: ["yarn", "install", "--frozen-lockfile", "--cache-folder", join(cache, "yarn")], env };
    default:
      return {
        command: "npm",
        args: [lock.file ? "ci" : "install", "--include=dev", "--no-audit", "--no-fund"],
        env: { ...env, npm_config_cache: join(cache, "npm") },
      };
  }
}

/** The commit of the clone's checkout, or null when it cannot be read. Mica changes it with a sync or a publication. */
export function headOf(repository: string): string | null {
  const git = join(repository, ".git");
  try {
    const head = readFileSync(join(git, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice("ref: ".length);
    if (existsSync(join(git, ref))) return readFileSync(join(git, ref), "utf8").trim();
    const packed = readFileSync(join(git, "packed-refs"), "utf8").split("\n").find((line) => line.endsWith(` ${ref}`));
    return packed?.split(" ")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * The image of the self-hosted live preview (ADR 38): it runs the website's
 * `MICA_PREVIEW=1 astro dev` from Mica's clone, on its drafts. Mica's volume is
 * read-only here, and the container has none of Mica's secrets.
 *
 * It copies the repository into a folder of its own, links the content root
 * to the clone's, so that each draft is there at once, installs with the
 * site's lock file, and starts the dev server on port 4321. When the clone's
 * commit changes, after a sync or a publication, it copies again; it installs
 * again only when the lock file changed, and starts the dev server again only
 * when a file changed. After a failure, it tries again a little later.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { contentRootIn, headOf, installCommand, installKey, lockFileOf, siteIn } from "./layout.js";
import { mirror } from "./mirror.js";

const env = process.env;
const CLONE = env["MICA_PREVIEW_CLONE"] ?? "/mica/repository";
const WORK = env["MICA_PREVIEW_WORK"] ?? "/work";
const CACHE = env["MICA_PREVIEW_CACHE"] ?? "/cache";
/** The files of the last copy: only these may go when the clone no longer has them. */
const COPIED = join(WORK, ".mica-preview-files.json");
const POLL_MS = 5_000;
/** A dev server that ran this long is no crash loop: the next start waits from the beginning again. */
const STABLE_MS = 60_000;

const log = (message: string): void => console.log(`[mica-preview] ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The editor's origin, which the page script answers: from MICA_PUBLIC_URL. */
function editorOrigin(): string | null {
  try {
    return env["MICA_PUBLIC_URL"] ? new URL(env["MICA_PUBLIC_URL"]).origin : null;
  } catch {
    return null;
  }
}

/** Runs a command to its end, with its output in the log. True when it succeeded. */
function run(command: string, args: string[], cwd: string, extra: Record<string, string>): Promise<boolean> {
  log(`${command} ${args.join(" ")} (in ${cwd})`);
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: { ...env, ...extra } });
    child.on("error", (error) => {
      log(`${command} did not start: ${describe(error)}`);
      resolve(false);
    });
    child.on("exit", (code) => resolve(code === 0));
  });
}

/** The content root in the copy: a link to the clone's, so that the dev server sees each draft at once. */
function linkContent(root: string): void {
  const link = join(WORK, root);
  const target = join(CLONE, root);
  try {
    const existing = lstatSync(link);
    if (existing.isSymbolicLink() && readlinkSync(link) === target) return;
    rmSync(link, { recursive: true, force: true });
  } catch {
    // Not there yet.
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, "dir");
}

/** Astro's command, from the site's own packages, as a workspace may have them in its root. */
function astroOf(site: string): string {
  const astro = createRequire(join(site, "package.json")).resolve("astro/package.json");
  return join(dirname(astro), "bin", "astro.mjs");
}

let server: ChildProcess | null = null;
let stopping = false;
let crashes = 0;

function startServer(site: string): void {
  const origin = editorOrigin();
  const started = Date.now();
  stopping = false;
  log(`Starting astro dev in ${site}`);
  const child = spawn(process.execPath, [astroOf(site), "dev", "--host", "0.0.0.0", "--port", "4321", "--ignore-lock"], {
    cwd: site,
    stdio: "inherit",
    env: { ...env, MICA_PREVIEW: "1", ...(origin ? { MICA_PREVIEW_EDITOR: origin } : {}) },
  });
  server = child;
  child.on("exit", (code, signal) => {
    if (server !== child || stopping) return;
    server = null;
    // It stopped by itself: again, a little later each time it does so soon.
    crashes = Date.now() - started > STABLE_MS ? 1 : crashes + 1;
    const wait = Math.min(2 ** crashes * 1_000, 60_000);
    log(`astro dev stopped (${signal ?? code}). It starts again in ${wait / 1000} s.`);
    setTimeout(() => {
      if (!server && !stopping) startServer(site);
    }, wait);
  });
}

async function stopServer(): Promise<void> {
  const child = server;
  stopping = true;
  server = null;
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(10_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

/** The key of the last install that succeeded, so that only a change of the lock file installs again. */
let installed = "";
let copiedFiles = new Set<string>();
try {
  copiedFiles = new Set(JSON.parse(readFileSync(COPIED, "utf8")) as string[]);
} catch {
  // A first start.
}

/** Copies the website, links the drafts, installs when needed, and starts the dev server when something changed. */
async function update(root: string): Promise<void> {
  const site = siteIn(CLONE, root, env["MICA_PREVIEW_SITE_PATH"]);
  const copy = mirror(CLONE, WORK, new Set([root]), copiedFiles);
  copiedFiles = copy.files;
  writeFileSync(COPIED, JSON.stringify([...copiedFiles]));
  linkContent(root);
  const lock = lockFileOf(CLONE, site);
  const key = installKey(CLONE, lock);
  // A publication or a sync of content only: the dev server already has all of it.
  if (server && key === installed && copy.copied + copy.removed === 0) return;
  log(`Copied the website: ${copy.copied} files copied, ${copy.removed} removed.`);
  await stopServer();
  if (key !== installed) {
    // A failed install can leave no packages: until one succeeds, each try installs.
    installed = "";
    const install = installCommand(lock, CACHE);
    if (!(await run(install.command, install.args, join(WORK, lock.folder), install.env))) throw new Error("The install failed.");
    if (existsSync(join(WORK, lock.folder, ".pnp.cjs"))) {
      throw new Error("The site installs with Yarn Plug'n'Play, which the preview image cannot run. Set nodeLinker: node-modules in .yarnrc.yml, or use an image of your own.");
    }
    installed = key;
  }
  startServer(join(WORK, site));
}

async function main(): Promise<void> {
  // The site's code runs here: it must not be able to write Mica's drafts.
  let writable = false;
  try {
    accessSync(dirname(CLONE), constants.W_OK);
    writable = true;
  } catch {
    // Read-only, as it must be.
  }
  if (writable) throw new Error(`Mica's volume is writable here. Mount it read-only, such as mica-data:${dirname(CLONE)}:ro.`);
  if (!editorOrigin()) log("MICA_PUBLIC_URL is not set: the page answers only an editor on this machine.");

  log(`Waiting for Mica's clone in ${CLONE}`);
  let root: string | null = null;
  while (!(root = contentRootIn(CLONE, env["MICA_CONTENT_PATH"]))) await sleep(2_000);
  log(`Content root: ${root}`);

  let head = headOf(CLONE);
  let busy = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const cycle = async (): Promise<void> => {
    clearTimeout(retry);
    busy = true;
    try {
      await update(contentRootIn(CLONE, env["MICA_CONTENT_PATH"]) ?? root!);
      failures = 0;
    } catch (error) {
      // The registry or the network can be away for a moment: again later, or at the next change of the website.
      failures++;
      const wait = Math.min(2 ** failures * 15_000, 600_000);
      log(`${describe(error)} The preview tries again in ${wait / 1000} s, or at the next change of the website.`);
      retry = setTimeout(() => void cycle(), wait);
    } finally {
      busy = false;
    }
  };
  await cycle();

  setInterval(() => {
    const now = headOf(CLONE);
    if (busy || !now || now === head) return;
    head = now;
    log(`The clone is at ${now.slice(0, 8)}.`);
    void cycle();
  }, POLL_MS);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void stopServer().then(() => process.exit(0));
  });
}

main().catch((error: unknown) => {
  log(describe(error));
  process.exit(1);
});

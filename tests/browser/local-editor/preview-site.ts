/**
 * Starts the example site with `MICA_PREVIEW=1 astro dev`, and `mica start` on
 * its content, for the live preview's browser test. See ../README.md.
 */

import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { freePort, ready, REPOSITORY, spawnEditor } from "./editor.js";

const EXAMPLE = join(REPOSITORY, "examples/company-site");
/** Build output and caches of the example: the copy makes its own. */
const SKIPPED = new Set(["node_modules", "dist", ".astro", "rush-logs", ".env"]);

export interface PreviewSite {
  /** The copy of the example site, a Git repository of its own. */
  site: string;
  /** The editor's address. */
  address: string;
  git(...args: string[]): string;
  stop(): void;
}

export async function startPreviewSite(): Promise<PreviewSite> {
  // In the repository's ignored `.tmp/`: the example's Vite config allows the files of Rush two folders up.
  mkdirSync(join(REPOSITORY, ".tmp"), { recursive: true });
  const site = mkdtempSync(join(REPOSITORY, ".tmp", "browser-preview-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: site, encoding: "utf8" }).trim();

  cpSync(EXAMPLE, site, { recursive: true, filter: (source) => dirname(source) !== EXAMPLE || !SKIPPED.has(basename(source)) });
  // The installed packages, each linked, so that Vite's cache stays in the copy.
  mkdirSync(join(site, "node_modules"));
  for (const entry of readdirSync(join(EXAMPLE, "node_modules"))) {
    if (entry !== ".vite") symlinkSync(join(EXAMPLE, "node_modules", entry), join(site, "node_modules", entry));
  }
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Browser Test");
  git("config", "user.email", "browser-test@example.com");
  git("add", "--all");
  git("commit", "--quiet", "--message", "The example site");

  const port = await freePort();
  let output = "";
  // `--ignore-lock` keeps the server in this process: Astro moves it to the background when it finds a coding agent.
  const astro = spawn(process.execPath, [join(site, "node_modules/astro/bin/astro.mjs"), "dev", "--port", String(port), "--ignore-lock"], {
    cwd: site,
    env: { ...process.env, MICA_PREVIEW: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  astro.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  astro.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));

  try {
    // The first request renders the page: it waits until the dev server has loaded the content.
    await ready(astro, `http://localhost:${port}/`, () => output, 90);
    const { address, editor } = await spawnEditor(join(site, "content"), site);
    return {
      site,
      address,
      git,
      stop: () => {
        editor.kill();
        astro.kill();
        rmSync(site, { recursive: true, force: true });
      },
    };
  } catch (error) {
    astro.kill();
    rmSync(site, { recursive: true, force: true });
    throw error;
  }
}

/**
 * `mica start --preview`: the project's `astro dev` with `MICA_PREVIEW=1`
 * beside the editor, so that one command gives the editor and its live
 * preview. The editor finds the dev server through its marker, as it finds one
 * that runs in another terminal.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const CONFIGS = ["mjs", "js", "ts", "mts", "cjs", "cts"].map((extension) => `astro.config.${extension}`);

/** The nearest directory at or above the content root with an `astro.config.*`; null when there is none. */
export function astroProjectRoot(contentRoot: string): string | null {
  for (let dir = path.resolve(contentRoot); ; dir = path.dirname(dir)) {
    if (CONFIGS.some((name) => existsSync(path.join(dir, name)))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

/** The project's own `astro` command, as a script for Node: no shell and no `.cmd` file, also on Windows. */
export function astroCommand(projectRoot: string): string | null {
  try {
    const manifest = createRequire(path.join(projectRoot, "package.json")).resolve("astro/package.json");
    const { bin } = JSON.parse(readFileSync(manifest, "utf8")) as { bin?: string | Record<string, string> };
    const script = typeof bin === "string" ? bin : bin?.["astro"];
    return script ? path.resolve(path.dirname(manifest), script) : null;
  } catch {
    return null;
  }
}

/**
 * Starts `astro dev` in the project. It stops when Mica exits. When it fails,
 * `onFail` gets its exit code; a dev server that stops cleanly, as on Ctrl+C,
 * only takes the preview away.
 */
export function startAstroDev(options: { projectRoot: string; command: string; env: NodeJS.ProcessEnv; onFail(code: number): void }): void {
  // Mica owns the dev server's lifetime: without the lock, Astro never moves it to the background, as it does for a coding agent.
  const child = spawn(process.execPath, [options.command, "dev", "--ignore-lock"], {
    cwd: options.projectRoot,
    env: { ...options.env, MICA_PREVIEW: "1" },
    // Ctrl+C reaches both processes from the terminal; stdin stays Mica's.
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("error", () => options.onFail(1));
  child.on("exit", (code) => {
    if (code !== null && code !== 0) options.onFail(code);
  });
  // A `kill` of Mica and a failed start reach only Mica.
  process.on("exit", () => child.kill());
}

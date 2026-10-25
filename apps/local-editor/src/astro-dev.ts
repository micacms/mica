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

/** The dev server that `--preview` started, for the editor's preview status: null when it started none. */
export interface StartedDevServer {
  running: boolean;
  /** How it ended: its exit code, or the signal that ended it. */
  exit: number | string | null;
  /** Its last lines of output, without colours, the oldest first (ADR 40). */
  lines: string[];
}

let started: StartedDevServer | null = null;

const LINES_KEPT = 50;
// ESC and CSI sequences: the colours of astro dev.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-_]/g;

/** Keeps the last lines of a stream of chunks, which can cut a line in two. */
function keepLines(lines: string[]): (chunk: string) => void {
  let partial = "";
  return (chunk) => {
    const parts = (partial + chunk).split(/\r?\n/);
    partial = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.replace(ANSI, "").trimEnd();
      if (!line) continue;
      lines.push(line);
      if (lines.length > LINES_KEPT) lines.shift();
    }
  };
}

export const startedDevServer = (): StartedDevServer | null => started;

/**
 * Starts `astro dev` in the project. It stops when Mica exits. When it fails,
 * `onFail` gets its exit code; a dev server that stops cleanly, as on Ctrl+C,
 * only takes the preview away.
 */
export function startAstroDev(options: { projectRoot: string; command: string; env: NodeJS.ProcessEnv; onFail(code: number): void }): void {
  // Mica owns the dev server's lifetime: without the lock, Astro never moves it to the background, as it does for a coding agent.
  const child = spawn(process.execPath, [options.command, "dev", "--ignore-lock"], {
    cwd: options.projectRoot,
    // Through a pipe, Astro sees no terminal: it keeps its colours only when Mica's terminal shows them.
    env: { ...options.env, MICA_PREVIEW: "1", ...(process.stdout.isTTY && !options.env["NO_COLOR"] ? { FORCE_COLOR: "1" } : {}) },
    // Ctrl+C reaches both processes from the terminal; stdin stays Mica's. The output goes on to the
    // terminal, and its last lines to the System page.
    stdio: ["ignore", "pipe", "pipe"],
  });
  const run: StartedDevServer = { running: true, exit: null, lines: [] };
  started = run;
  const out = keepLines(run.lines);
  const err = keepLines(run.lines);
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    out(chunk.toString("utf8"));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    err(chunk.toString("utf8"));
  });
  child.on("error", () => options.onFail(1));
  child.on("exit", (code, signal) => {
    run.running = false;
    run.exit = code ?? signal;
    if (code !== null && code !== 0) options.onFail(code);
  });
  // A `kill` of Mica and a failed start reach only Mica.
  process.on("exit", () => child.kill());
}

/**
 * Starts `mica start` from the local build on a temporary Git repository with
 * the starter's content, for the local editor's browser tests. See ../README.md.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPOSITORY = resolve(import.meta.dirname, "../../..");
const CLI = join(REPOSITORY, "apps/local-editor/dist/cli.js");
const FIXTURE = join(REPOSITORY, "examples/starter/content");

export interface LocalEditor {
  /** The developer's checkout, with the content in `content/`. */
  site: string;
  /** The address that the editor prints. It accepts writes only from this one. */
  address: string;
  git(...args: string[]): string;
  /** Git in the bare remote, with `remote: true`. */
  remoteGit(...args: string[]): string;
  /** Makes the remote unreachable, and returns the function that brings it back. */
  cutRemote(): () => void;
  stop(): void;
}

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A port that nothing listens on now. */
async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

/** Waits until the editor answers, or fails with what it printed. */
async function ready(editor: ChildProcess, url: string, output: () => string): Promise<void> {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (editor.exitCode !== null) throw new Error(`mica start stopped:\n${output()}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 200));
  }
  throw new Error(`mica start did not answer in 30 seconds:\n${output()}`);
}

/** With `remote: true`, the checkout has a bare `origin`, and the branch tracks it. */
export async function startLocalEditor(options: { remote?: boolean } = {}): Promise<LocalEditor> {
  if (!existsSync(CLI)) throw new Error(`There is no local editor build at ${CLI}. Run rush build first.`);

  const site = mkdtempSync(join(tmpdir(), "mica-browser-"));
  const bare = options.remote ? mkdtempSync(join(tmpdir(), "mica-browser-remote-")) : null;
  const git = (...args: string[]) => run(site, args);

  cpSync(FIXTURE, join(site, "content"), { recursive: true });
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Browser Test");
  git("config", "user.email", "browser-test@example.com");
  git("add", "--all");
  git("commit", "--quiet", "--message", "The starter's content");
  if (bare) {
    run(bare, ["init", "--quiet", "--bare", "--initial-branch=main"]);
    git("remote", "add", "origin", bare);
    git("push", "--quiet", "--set-upstream", "origin", "main");
  }

  const port = await freePort();
  const address = `http://localhost:${port}`;
  let output = "";
  const editor = spawn(process.execPath, [CLI, "start", join(site, "content"), "--port", String(port), "--no-open"], {
    cwd: site,
    stdio: ["ignore", "pipe", "pipe"],
  });
  editor.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  editor.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  await ready(editor, `${address}/api/auth/config`, () => output);

  return {
    site,
    address,
    git,
    remoteGit: (...args) => {
      if (!bare) throw new Error("This editor has no remote.");
      return run(bare, args);
    },
    cutRemote: () => {
      if (!bare) throw new Error("This editor has no remote.");
      renameSync(bare, `${bare}.away`);
      return () => renameSync(`${bare}.away`, bare);
    },
    stop: () => {
      editor.kill();
      rmSync(site, { recursive: true, force: true });
      if (bare) rmSync(bare, { recursive: true, force: true });
    },
  };
}

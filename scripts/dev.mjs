#!/usr/bin/env node
/**
 * `rush dev` — the local development loop.
 *
 * Builds the dependency closure of the local editor and its UI, then watches
 * both in parallel: `tsx watch` for the editor process, Vite for the UI. This
 * is what `pnpm --parallel --filter @micacms/editor --filter @micacms/editor-ui
 * dev` used to do; Rush has no parallel watch across projects, so a script
 * holds the two processes instead.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUSH = path.join(ROOT, "common/scripts/install-run-rush.js");

const WATCHED = [
  { label: "editor", folder: "apps/local-editor" },
  { label: "ui", folder: "packages/editor-ui" },
];

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

await run(process.execPath, [
  RUSH,
  "build",
  "--to",
  "@micacms/editor",
  "--to",
  "@micacms/editor-ui",
], { cwd: ROOT });

// `npm run` needs no install of its own: it reads the project's package.json
// and puts the project's node_modules/.bin — where Rush linked tsx and Vite —
// on the PATH.
const children = WATCHED.map(({ label, folder }) => {
  const child = spawn("npm", ["run", "--silent", "dev"], {
    cwd: path.join(ROOT, folder),
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const prefix = (stream, out) =>
    stream.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) out.write(`[${label}] ${line}\n`);
      }
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  return child;
});

// One process dying, or Ctrl-C, takes both down — half a dev loop is worse
// than none.
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(0));
for (const child of children) child.on("exit", (code) => shutdown(code ?? 1));

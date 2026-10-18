#!/usr/bin/env node
/**
 * Tests the packed packages in a new Astro project, as a user installs them (#128).
 *
 *   rush build && node scripts/pack-test.mjs
 *
 * It packs the published packages as the release does, copies the starter
 * (`examples/starter`) to a temporary folder, installs the tarballs there
 * instead of the registry versions, and then runs what a user runs first:
 * `mica --version`, `mica check`, `astro build`, and `mica start` until the
 * editor answers. It needs the network for the other dependencies, such as
 * Astro. It changes nothing in the repository.
 */

import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(path.join(tmpdir(), "mica-pack-test-"));
const packages = path.join(work, "packages");
const site = path.join(work, "site");
const windows = process.platform === "win32";

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: windows });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}.`);
}

/** A free port on this machine, for the editor. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** Starts the editor, waits until `/health` answers, and stops it. */
async function startAndStop() {
  const port = await freePort();
  const bin = path.join(site, "node_modules", ".bin", windows ? "mica.cmd" : "mica");
  console.log(`\n$ mica start --no-open --port ${port}`);
  const editor = spawn(bin, ["start", "--no-open", "--port", String(port)], { cwd: site, stdio: "inherit", shell: windows });
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (editor.exitCode !== null) throw new Error(`mica start stopped with ${editor.exitCode}.`);
      const ok = await fetch(`http://localhost:${port}/health`).then((response) => response.ok, () => false);
      if (ok) {
        console.log(`The editor answers on port ${port}.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("The editor did not answer within 30 seconds.");
  } finally {
    editor.kill();
  }
}

try {
  // `--pack --publish` writes the tarballs that the release publishes; it publishes nothing.
  run("node", ["common/scripts/install-run-rush.js", "publish", "--include-all", "--pack", "--publish", "--release-folder", packages], ROOT);
  const tarballs = Object.fromEntries(
    readdirSync(packages)
      .filter((file) => file.endsWith(".tgz"))
      .map((file) => [`@micacms/${file.replace(/^micacms-/, "").replace(/-\d+\.\d+\.\d+.*\.tgz$/, "")}`, `file:${path.join(packages, file)}`]),
  );
  console.log(`\nTarballs: ${Object.keys(tarballs).join(", ")}`);

  cpSync(path.join(ROOT, "examples/starter"), site, {
    recursive: true,
    filter: (source) => !/[\\/](node_modules|dist|\.astro)([\\/]|$)/.test(source),
  });

  // Each @micacms package, also the ones that @micacms/editor installs, comes from its tarball.
  const manifest = JSON.parse(readFileSync(path.join(site, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(manifest[field] ?? {})) if (tarballs[name]) manifest[field][name] = tarballs[name];
  }
  manifest.overrides = tarballs;
  writeFileSync(path.join(site, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  run("npm", ["install", "--no-audit", "--no-fund"], site);

  // The tarballs have the version of a release on npm: make sure that npm took the tarballs.
  const lock = JSON.parse(readFileSync(path.join(site, "package-lock.json"), "utf8"));
  const installed = Object.entries(lock.packages).filter(([key]) => /(^|\/)node_modules\/@micacms\//.test(key));
  const fromRegistry = installed.filter(([, entry]) => !String(entry.resolved ?? "").startsWith("file:")).map(([key]) => key);
  if (fromRegistry.length > 0) throw new Error(`Not from a tarball: ${fromRegistry.join(", ")}`);
  if (installed.length < Object.keys(tarballs).length) throw new Error(`Only ${installed.length} @micacms packages are installed.`);
  console.log(`All ${installed.length} @micacms packages come from the tarballs.`);
  run("npx", ["--no", "mica", "--version"], site);
  run("npx", ["--no", "mica", "check"], site);
  run("npx", ["--no", "astro", "build"], site);
  await startAndStop();
  console.log("\nThe packed packages work in a new Astro project.");
} finally {
  rmSync(work, { recursive: true, force: true });
}

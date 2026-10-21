#!/usr/bin/env node
/**
 * Prepares the website that the preview's test stack seeds (see README.md):
 * the example site in `tests/preview/site/`, with the packed @micacms packages
 * in its `vendor/` folder and a lock file, as a user's project has them. The
 * preview image installs it with `npm ci`. It needs the network for the other
 * packages, such as Astro.
 *
 *   node tests/preview/prepare-site.mjs
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const site = path.join(ROOT, "tests/preview/site");
const packed = mkdtempSync(path.join(tmpdir(), "mica-preview-site-"));

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}.`);
}

try {
  run("node", ["common/scripts/install-run-rush.js", "build", "--to", "@micacms/astro"], ROOT);
  // `--pack --publish` writes the tarballs that the release publishes; it publishes nothing.
  run("node", ["common/scripts/install-run-rush.js", "publish", "--include-all", "--pack", "--publish", "--release-folder", packed], ROOT);

  rmSync(site, { recursive: true, force: true });
  cpSync(path.join(ROOT, "examples/company-site"), site, {
    recursive: true,
    filter: (source) => !/[\\/](node_modules|dist|\.astro|rush-logs|\.env)([\\/]|$)/.test(path.relative(ROOT, source)),
  });

  // Only what the website needs: the editor is not part of it here.
  const manifest = JSON.parse(readFileSync(path.join(site, "package.json"), "utf8"));
  delete manifest.devDependencies["@micacms/editor"];
  delete manifest.scripts.mica;
  manifest.overrides = {};
  mkdirSync(path.join(site, "vendor"));
  for (const name of ["core", "astro"]) {
    const tarball = readdirSync(packed).find((file) => file.startsWith(`micacms-${name}-`) && file.endsWith(".tgz"));
    if (!tarball) throw new Error(`There is no tarball of @micacms/${name}.`);
    copyFileSync(path.join(packed, tarball), path.join(site, "vendor", tarball));
    manifest.dependencies[`@micacms/${name}`] = `file:vendor/${tarball}`;
    manifest.overrides[`@micacms/${name}`] = `file:vendor/${tarball}`;
  }
  writeFileSync(path.join(site, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund", "--ignore-scripts"], site);
  console.log(`\nThe website for the preview's test stack is in ${path.relative(ROOT, site)}.`);
} finally {
  rmSync(packed, { recursive: true, force: true });
}

#!/usr/bin/env node
/**
 * Sets the version everything in this repository is released under.
 *
 *   pnpm release:version 0.2.0
 *
 * Everything here carries one version — three published packages, the CMS and
 * its image — so a release is one number in five manifests. Doing that by hand
 * is how four of them end up right and the fifth ships as the previous
 * version, which npm will happily accept and nobody notices until a bug report
 * quotes a version that never existed.
 *
 * Read-only checks live here too, because the moment to catch a missing
 * changelog entry is before the tag exists, not after the publish.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every manifest that carries the release version. */
export const MANIFESTS = [
  "package.json",
  "packages/model/package.json",
  "packages/connectors/package.json",
  "packages/astro/package.json",
  "apps/cms/package.json",
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function readVersions(root = ROOT) {
  return MANIFESTS.map((file) => ({
    file,
    version: JSON.parse(readFileSync(path.join(root, file), "utf8")).version,
  }));
}

/**
 * Rewrites the `version` field textually rather than through `JSON.parse` and
 * `JSON.stringify`, so key order, indentation and the trailing newline survive
 * untouched. A release should not also be a reformat of five files.
 */
export function setVersion(version, root = ROOT) {
  if (!SEMVER.test(version)) {
    throw new Error(`"${version}" is not a version. Expected e.g. 0.2.0 or 1.0.0-rc.1.`);
  }

  for (const file of MANIFESTS) {
    const target = path.join(root, file);
    const before = readFileSync(target, "utf8");
    const after = before.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);

    if (after === before && !before.includes(`"version": "${version}"`)) {
      throw new Error(`No version field to set in ${file}.`);
    }
    writeFileSync(target, after);
  }

  return version;
}

/** The notes for one version, lifted out of the changelog. */
export function changelogSection(version, root = ROOT) {
  const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const heading = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*$`, "m");

  const start = changelog.search(heading);
  if (start === -1) return null;

  const rest = changelog.slice(start);
  const end = rest.indexOf("\n## ", 1);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

function main(argv) {
  const version = argv[0];

  if (!version) {
    const current = readVersions();
    const agreed = new Set(current.map((entry) => entry.version));

    process.stdout.write(
      `${[...current.map((e) => `  ${e.version.padEnd(12)} ${e.file}`)].join("\n")}\n`,
    );
    if (agreed.size > 1) {
      process.stderr.write("\n  These disagree. Run `pnpm release:version <version>`.\n");
      process.exit(1);
    }
    process.stdout.write("\n  Usage: pnpm release:version <version>\n");
    return;
  }

  setVersion(version);

  const notes = changelogSection(version);
  const lines = [
    "",
    `  Set ${MANIFESTS.length} manifests to ${version}.`,
    "",
    notes
      ? `  CHANGELOG.md has a [${version}] section. Good.`
      : `  ⚠ CHANGELOG.md has no [${version}] section — the release notes come from it.`,
    "",
    "  Next:",
    "    git commit -am \"Release " + version + "\"",
    "    git tag v" + version,
    "    git push origin main --follow-tags",
    "",
    "  Pushing the tag publishes. Nothing before that does.",
    "",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
  if (!notes) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));

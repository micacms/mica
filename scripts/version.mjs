#!/usr/bin/env node
/**
 * Sets the version everything in this repository is released under.
 *
 *   pnpm release:version 0.2.0
 *
 * Everything here carries one version — three published packages, the editor
 * and its image — so a release is one number in six files. Doing that by hand
 * is how five of them end up right and the sixth ships as the previous
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

/** A manifest's `version` field. */
const VERSION_FIELD = /^(\s*"version":\s*")([^"]+)(")/m;

/** The image tag in the reference deployment, which carries the same version. */
const IMAGE_TAG = /^(\s*image:\s*ghcr\.io\/amuedespacher\/micacms:)(\S+)(\s*)$/m;

/**
 * Every file that carries the release version, and the pattern that finds it.
 *
 * The compose file is here because it is the one that drifts: it holds the
 * version in an image tag rather than a `version` field, so a rewrite that only
 * knew about manifests left the reference deployment pinned a release behind.
 *
 * Each pattern captures prefix, version and suffix, so a rewrite replaces the
 * middle group and nothing else in the file moves.
 */
export const MANIFESTS = [
  { file: "package.json", pattern: VERSION_FIELD },
  { file: "packages/core/package.json", pattern: VERSION_FIELD },
  // The old name, kept as a re-export for one release cycle. It carries the
  // lockstep version like everything else while it exists.
  { file: "packages/model/package.json", pattern: VERSION_FIELD },
  { file: "packages/connectors/package.json", pattern: VERSION_FIELD },
  { file: "packages/astro/package.json", pattern: VERSION_FIELD },
  { file: "packages/editor/package.json", pattern: VERSION_FIELD },
  { file: "docker-compose.yml", pattern: IMAGE_TAG },
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function readVersions(root = ROOT) {
  return MANIFESTS.map(({ file, pattern }) => {
    const match = readFileSync(path.join(root, file), "utf8").match(pattern);
    if (!match) throw new Error(`No version to read in ${file}.`);
    return { file, version: match[2] };
  });
}

/**
 * Rewrites the version textually rather than through a parser, so key order,
 * indentation, comments and the trailing newline survive untouched. A release
 * should not also be a reformat of every file it touches.
 */
export function setVersion(version, root = ROOT) {
  if (!SEMVER.test(version)) {
    throw new Error(`"${version}" is not a version. Expected e.g. 0.2.0 or 1.0.0-rc.1.`);
  }

  for (const { file, pattern } of MANIFESTS) {
    const target = path.join(root, file);
    const before = readFileSync(target, "utf8");

    if (!pattern.test(before)) throw new Error(`No version to set in ${file}.`);
    writeFileSync(target, before.replace(pattern, `$1${version}$3`));
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
    `  Set ${MANIFESTS.length} files to ${version}.`,
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

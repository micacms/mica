#!/usr/bin/env node
/**
 * Sets the one version that every published package, both apps and the image carry.
 *
 *   rush release-version --version 0.2.0
 *
 * It also checks for the changelog section, before the tag exists.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VERSION_FIELD = /^(\s*"version":\s*")([^"]+)(")/m;

/** The image tag in the reference deployment, which carries the same version. */
const IMAGE_TAG = /^(\s*image:\s*ghcr\.io\/micacms\/mica:)(\S+)(\s*)$/m;
/** The preview image's tag in the reference deployment, where the optional service is a comment. */
const PREVIEW_TAG = /^(\s*#?\s*image:\s*ghcr\.io\/micacms\/preview:)(\S+)(\s*)$/m;

/**
 * Every file that carries the release version, and the pattern that finds it.
 * Each pattern captures prefix, version and suffix, so a rewrite replaces only the middle group.
 */
export const MANIFESTS = [
  // The lockstep policy `rush version --bump` bumps from. Managed here too, so
  // a manual `rush release-version` cannot leave Rush bumping from a stale base.
  { file: "common/config/rush/version-policies.json", pattern: VERSION_FIELD },
  { file: "packages/core/package.json", pattern: VERSION_FIELD },
  { file: "packages/astro/package.json", pattern: VERSION_FIELD },
  { file: "packages/editor-ui/package.json", pattern: VERSION_FIELD },
  { file: "packages/runtime/package.json", pattern: VERSION_FIELD },
  { file: "packages/mcp/package.json", pattern: VERSION_FIELD },
  { file: "packages/auth/oidc/package.json", pattern: VERSION_FIELD },
  { file: "apps/local-editor/package.json", pattern: VERSION_FIELD },
  { file: "apps/self-hosted/package.json", pattern: VERSION_FIELD },
  { file: "apps/preview/package.json", pattern: VERSION_FIELD },
  { file: "deploy/self-hosted/compose.yml", pattern: IMAGE_TAG },
  { file: "deploy/self-hosted/compose.yml", pattern: PREVIEW_TAG },
  { file: "deploy/demo-identity/compose.yml", pattern: IMAGE_TAG },
  // The starter installs the published packages; it follows each release.
  { file: "examples/starter/package.json", pattern: /^(\s*"@micacms\/astro":\s*"\^)([^"]+)(")/m },
  { file: "examples/starter/package.json", pattern: /^(\s*"@micacms\/core":\s*"\^)([^"]+)(")/m },
  { file: "examples/starter/package.json", pattern: /^(\s*"@micacms\/editor":\s*"\^)([^"]+)(")/m },
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
 * Rewrites the version as text, not through a parser, so formatting and
 * comments stay as they are.
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
  let version = argv[0];

  // Rush passes the version as `--version 0.2.0`; a bare `0.2.0` still works
  // for anyone running the script directly.
  if (version === "--version") version = argv[1];

  // `rush version --bump` does not know the image tag: `--sync` carries the
  // version Rush chose to every file.
  if (version === "--sync") {
    version = JSON.parse(
      readFileSync(path.join(ROOT, "packages/core/package.json"), "utf8"),
    ).version;
  }

  if (!version) {
    const current = readVersions();
    const agreed = new Set(current.map((entry) => entry.version));

    process.stdout.write(
      `${[...current.map((e) => `  ${e.version.padEnd(12)} ${e.file}`)].join("\n")}\n`,
    );
    if (agreed.size > 1) {
      process.stderr.write("\n  These disagree. Run `rush release-version --version <version>`.\n");
      process.exit(1);
    }
    process.stdout.write("\n  Usage: rush release-version --version <version>\n");
    return;
  }

  setVersion(version);

  const notes = changelogSection(version);
  const lines = [
    "",
    `  Set ${new Set(MANIFESTS.map((entry) => entry.file)).size} files to ${version}.`,
    "",
    notes
      ? `  CHANGELOG.md has a [${version}] section. Good.`
      : `  ⚠ CHANGELOG.md has no [${version}] section — the release notes come from it.`,
    "",
    "  Next:",
    "    git commit -am \"Release " + version + "\"",
    "    git tag -a v" + version + ' -m "Release ' + version + '"',
    // Atomic: the commit and the tag arrive together, or neither does.
    "    git push --atomic origin main v" + version,
    "",
    "  Pushing the tag publishes. Nothing before that does.",
    "",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
  if (!notes) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));

---
name: release
description: Cut a Mica release end to end — suggest the bump from the pending change files, write the CHANGELOG section, run the version bump, verify every manifest agrees, and hand over the commit/tag/push that publishes. Use when the user wants to release, bump the version, or run version-bump.
argument-hint: "[patch|minor|major]"
---

Cut one Mica release. Everything publishes in lockstep — eight npm packages
and the Docker image carry one version — and pushing the tag is what
publishes, so nothing here pushes without the user saying so.

## 0. Preconditions — check each, stop and say so on failure

- On `main`, working tree clean, in sync with `origin/main` (fetch first).
- Pending change files exist under `common/changes/`. None means nothing to
  release: stop. (A version can still be forced with
  `rush release-version --version X.Y.Z`, but that consumes no change files
  and writes no package changelogs — say so rather than doing it.)
- If the tree holds a **half-finished bump** — modified manifests, deleted
  change files, untracked per-package `CHANGELOG.md`/`CHANGELOG.json` — a
  previous run died partway. Restore before anything else:
  `git restore .` and delete those untracked generated changelogs. The change
  files come back with the restore; nothing is lost.

## 1. Choose the bump

Read every `common/changes/**/*.json` **now** — the bump consumes them, so
this is the only moment to read them. Note each entry's `type` and `comment`.

- Suggested bump: the largest type present (`major` > `minor` > `patch`);
  `none` entries never bump anything. While the major version is 0, that
  suggestion is usually right as-is — do not promote to major on your own.
- From 1.0, a `major` entry on an internal package (`runtime`, `auth-oidc`,
  `editor-ui`, `connectors`) is a mistake: internal breaks are `minor`. Point
  it out and suggest `minor`, unless the comment also breaks the public
  surface — see "Semver covers the public surface" in `docs/decisions.md`.
- Current version: `version` in `common/config/rush/version-policies.json`.
  Compute the target version from it and the bump.
- Ask the user with AskUserQuestion, suggested bump first, showing the
  resulting version for each option (e.g. "minor → 0.2.0 (Recommended)").

## 2. The root CHANGELOG section

`CHANGELOG.md` at the repo root is the product changelog: hand-written,
Keep-a-Changelog style, and the source of the GitHub release notes —
`scripts/version.mjs` refuses to finish without a section for the new version.

- If a `## [Unreleased]` section exists, retitle it
  `## [X.Y.Z] — YYYY-MM-DD` (em dash, today's date, matching the existing
  headings).
- Cross-check it against the change-file comments collected in step 1: the
  hand-written section may be missing something a change file records. Add
  what is missing in the section's own voice; deduplicate — lockstep repeats
  one comment across many packages, it is one entry here.
- If there was no `[Unreleased]` section, draft the whole section from the
  change-file comments and show the user before moving on.

## 3. Bump

- Chosen bump matches `nextBump` in version-policies.json (usually `minor`):
  run `rush version-bump`.
- Any other bump:
  `node common/scripts/install-run-rush.js version --bump --override-bump <type> && node scripts/version.mjs --sync`
- This rewrites every manifest and the compose image tag, writes each
  package's CHANGELOG from the change files, and deletes the change files.

## 4. Verify

- `node scripts/version.mjs` — must exit 0: every version-bearing file agrees
  and the CHANGELOG section is found.
- `common/changes/` holds no `.json` files anymore.
- Show the user a short diff summary (files changed, the new version).

## 5. Hand over — publish only on explicit confirmation

Show the three commands and run them **only when the user confirms each
intent** (committing and tagging on request; the push publishes to npm and
ghcr.io, so never run it without the user explicitly asking):

```bash
git commit -am "Release X.Y.Z"
git tag -a vX.Y.Z -m "Release X.Y.Z"
git push origin main --follow-tags
```

The release workflow re-runs the full CI gate before publishing, checks the
tag against every manifest, and builds the GitHub release notes from the
CHANGELOG section written in step 2.

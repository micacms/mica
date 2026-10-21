---
name: release
description: Cut a Mica release end to end — suggest the bump from the pending change files, write the CHANGELOG section, run the version bump, verify every manifest agrees, and hand over the commit/tag/push that publishes. Use when the user wants to release, bump the version, or run version-bump.
argument-hint: "[patch|minor|major|X.Y.Z-rc.N]"
---

Cut one Mica release. Everything publishes in lockstep — five npm packages
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
A change to the image is on `@micacms/runtime`, and a change to the editor UI
on `@micacms/editor`: the private projects have no change files of their own.

- Suggested bump: the largest type present (`major` > `minor` > `patch`);
  `none` entries never bump anything. While the major version is 0, that
  suggestion is usually right as-is — do not promote to major on your own.
- From 1.0, a `major` entry on an internal package (`runtime`, `auth-oidc`,
  `editor-ui`) is a mistake: internal breaks are `minor`. Point
  it out and suggest `minor`, unless the comment also breaks the public
  surface — see `docs/adr/0030-semver-covers-the-public-surface.md`.
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
- Before 1.0, keep the section short: what changed for a user, and what
  breaks. The website has no release entry before 1.0; the site-keeper
  updates the one `before-1-0` entry to the new state.

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
- `node scripts/pack-test.mjs` — must end with "The packed
  packages work in a new Astro project.": the tarballs of this version install
  in a copy of the starter, and `mica check`, `astro build` and `mica start`
  work there.
- Show the user a short diff summary (files changed, the new version).

## 5. Hand over — publish only on explicit confirmation

Show the three commands and run them **only when the user confirms each
intent** (committing and tagging on request; the push publishes to npm and
ghcr.io, so never run it without the user explicitly asking):

```bash
git commit -am "Release X.Y.Z"
git tag -a vX.Y.Z -m "Release X.Y.Z"
git push --atomic origin main vX.Y.Z
```

`--atomic` pushes the commit and the tag together or neither, so a tag never
publishes a commit that is not on `main`. The release workflow checks the tag
against every manifest and the CHANGELOG section, and re-runs the full CI gate
without any write right. Then it pushes the image, publishes npm behind the
`release` environment, and creates the GitHub release from that section.

When the workflow is green, check what reached the user:

- `npm view @micacms/core@X.Y.Z dist.attestations` is not empty: npm has the
  provenance of the release workflow. The workflow adds it only for a public
  repository. Check one more package the same way, such as `@micacms/editor`.
- `docker buildx imagetools inspect ghcr.io/micacms/mica:X.Y.Z` lists
  `linux/amd64` and `linux/arm64`, and an anonymous pull works. The same for
  the preview image, `ghcr.io/micacms/preview:X.Y.Z`. GitHub creates a new
  package private: if the anonymous pull of the preview image fails, the
  maintainer makes the package public in its settings.
- The keyless signatures and the SBOMs of both images verify with the
  `cosign verify` and `imagetools inspect` commands on the self-hosting page of
  micacms.com.
  Without `cosign` on this machine, say so: the maintainer runs it.

## A release candidate (`X.Y.Z-rc.N`)

A version with a `-` is a pre-release. The release workflow publishes it to
npm under `next`, pushes the image without `:latest`, and marks the GitHub
release as a pre-release.

- Do not run step 3. Set the version with
  `rush release-version --version X.Y.Z-rc.N`: it consumes no change files,
  so they stay for the final `X.Y.Z`.
- Step 2 writes a `## [X.Y.Z-rc.N] — YYYY-MM-DD` section. The final release
  gets its own `## [X.Y.Z]` section with the full notes.
- `deploy/self-hosted/compose.yml` then pins the candidate until the final
  release. Say so to the user.
- After the candidate: run it on a website in production for four weeks (see
  `docs/adr/0032-release-candidates.md`). A fix gives `rc.N+1`.
- The final release is a normal release: `rush version-bump` bumps
  `X.Y.Z-rc.N` to `X.Y.Z` and consumes the change files.
- For `1.0.0` only: before the bump, delete the `CHANGELOG.md` and
  `CHANGELOG.json` of each package, so that the package changelogs start at
  1.0.0, and fold the remaining 0.x sections of the root `CHANGELOG.md` into
  its one `0.x` section.

## A release that failed part of the way

Do not move the tag and do not bump again. Open the failed run and use
"Re-run failed jobs": `rush publish` skips every package whose version is
already on npm, the GitHub release step updates an existing release, and the
image job pushes the same tags again. Only when the commit itself is wrong:
fix it on `main` and release the next patch version.

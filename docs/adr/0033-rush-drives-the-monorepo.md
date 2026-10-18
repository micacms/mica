# 33. Rush drives the monorepo

**Status:** Accepted

## Context

The project needs one lockstep version, change files and changelogs, a build in dependency order, and a pruned install for the image.

## Decision

- Rush, pinned in `rush.json` with its own pinned pnpm, installs, builds, tests and releases the repository.
- One lockstep version policy, `mica`, holds the version of the published packages. A change file in `common/changes/` becomes a changelog entry. `rush change --verify` is the CI gate, and `rush version-bump` uses the change files.
- `rush deploy` makes the pruned install of the image.

## Consequences

- Each project is listed in `rush.json`, without globs. The `Dockerfile` copies the manifests of all listed projects.
- A contributor needs `rush`, or `node common/scripts/install-run-rush.js`.
- Dependabot cannot update the Rush lockfile. A monthly workflow runs `rush update --full`.
- `rush typecheck` and `rush test` read other packages from their `dist` folders, so `rush build` comes first.
- `rush change --verify` sees only the projects in a version policy, so a missing change file of a private project is found only in review.
- Revisit when: a pnpm workspace with a release tool gives the same with less configuration.

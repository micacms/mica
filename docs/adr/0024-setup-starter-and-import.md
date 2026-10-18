# 24. Setup: guides in the package, a starter, and `mica import`

**Status:** Accepted

## Context

The website deploys from `main`, and the packages from a tag. A guide on the website can describe a version that `npm install` does not give. A setup by a coding agent needs a check that the agent can run alone.

## Decision

- `SETUP.md` in the repository root is served at `micacms.com/setup.md`. It only routes: it finds the project's situation, installs the packages and sends the agent to one guide in `@micacms/astro/setup/`. It names no version-specific API.
- `mica check` is the agent's "done" signal. `mica init` writes the starter files.
- `mica import` reads Astro's data store (`node_modules/.astro/data-store.json`) and writes each entry into the Mica model by field name, with `--map` and `--order`.
- `examples/starter` is the minimal starter for `npm create astro -- --template micacms/mica/examples/starter`. It installs the published packages and is not a Rush project. `examples/company-site` shows every feature.

## Consequences

- A guide change reaches users only with a release.
- The data store is Astro's internal format. A new Astro version can break `mica import`; a script with `writeEntry` stays the fallback.
- The starter's `content/.mica/schema.json` is written by hand when its model changes.

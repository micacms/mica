# 30. Semver covers the public surface, not each published package

**Status:** Accepted

## Context

All packages share one lockstep version. If each package were public, each refactor of an internal helper would be a major for all packages. Adopters lose data when the format or the image contract breaks, not when an internal function changes.

## Decision

- From 1.0, semver covers: the entry points `@micacms/core` and `@micacms/core/node`, `@micacms/astro`, `@micacms/astro/relations` and `@micacms/astro/components`, the `@micacms/editor` CLI (commands, flags and exit codes), the MCP tool names and inputs, the image contract (environment variables, port, volume, `/health` and `/ready`), the content format and the manifest protocol.
- `@micacms/runtime` and `@micacms/mcp` are internal. They are on npm only because `@micacms/editor` installs them, pinned exactly. `@micacms/core/internal` is internal.
- `@micacms/editor-ui` and `@micacms/auth-oidc` are not published. A change to the editor UI records its change file for `@micacms/editor`; a change to the OIDC gate or the image records it for `@micacms/runtime`.
- In `rush change`, a break of an internal package is `minor`. `major` is only for a break of the public surface.
- zod 4 is a peer dependency of `@micacms/core` and `@micacms/astro`, because zod is in their public types and Astro needs the same copy.
- The admin HTTP API (`/api/admin/*`, `/api/auth/*`) is internal and has no version. The editor UI and the runtime ship together. The routes check their answers against the types that the editor imports. One mapping (`apiErrorOf`) gives the status of a content error for the admin API and the MCP tools: 409 for a conflict or a read-only part, 422 for an invalid value or a file that Mica cannot read, 404 for an unknown part, 400 for other content errors, and 500 for a bug.

## Consequences

- The page "Versions and support" on micacms.com states this surface, the deprecation rule, the support window and the version skew between the image and `@micacms/astro`.

- The API reports in `packages/core/api/` and `packages/astro/api/` show each change of the public TypeScript surface. CI fails when a report is not the built API, so a change is always a decision in a pull request.

- npm has no "internal" flag. A project that depends on an internal package can break in a minor. The line holds only while the public packages do not export internal symbols again.
- An editor tab that stays open during an upgrade runs the old editor against the new API until it reloads.
- A move to zod 5 is a Mica major.
- A script against the admin API can break in any release. Automation uses the MCP tools.

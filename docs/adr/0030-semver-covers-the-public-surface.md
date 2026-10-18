# 30. Semver covers the public surface, not each published package

**Status:** Accepted

## Context

All packages share one lockstep version. If each package were public, each refactor of an internal helper would be a major for all packages. Adopters lose data when the format or the image contract breaks, not when an internal function changes.

## Decision

- From 1.0, semver covers: the main entry points of `@micacms/core` and `@micacms/core/node`, `@micacms/astro`, the `@micacms/editor` CLI, the MCP tool names and inputs, the image contract (environment variables, port, volume, `/health` and `/ready`), the content format and the manifest protocol.
- `@micacms/runtime` and `@micacms/mcp` are internal. They are on npm only because `@micacms/editor` installs them, pinned exactly. `@micacms/core/internal` is internal.
- `@micacms/editor-ui` and `@micacms/auth-oidc` are not published. A change to the editor UI records its change file for `@micacms/editor`; a change to the OIDC gate or the image records it for `@micacms/runtime`.
- In `rush change`, a break of an internal package is `minor`. `major` is only for a break of the public surface.
- zod 4 is a peer dependency of `@micacms/core` and `@micacms/astro`, because zod is in their public types and Astro needs the same copy.
- The admin HTTP API (`/api/admin/*`, `/api/auth/*`) is internal and has no version. The editor UI and the runtime ship together. The routes check their answers against the types that the editor imports.

## Consequences

- npm has no "internal" flag. A project that depends on an internal package can break in a minor.
- A move to zod 5 is a Mica major.
- A script against the admin API can break in any release. Automation uses the MCP tools.

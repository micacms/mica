# 28. Agents edit through MCP, and save drafts by default

**Status:** Accepted

## Context

Agents are a second client of the editor's services. Content that an agent reads can carry instructions (prompt injection). The admin API is internal ([30](0030-semver-covers-the-public-surface.md)).

## Decision

- `@micacms/mcp` gives agents a fixed set of tools over the Model Context Protocol: read the model and the content, save entries and singletons, delete and reorder entries, upload media, list and discard the drafts, search reference data, and publish. The tools are the same for each model.
- One definition serves three entry points: `npx mica mcp` over stdio, `/mcp` in the local editor, and `/mcp` in the image behind OAuth ([29](0029-mica-is-the-authorization-server-for-mcp.md)). The image needs `MICA_MCP=true`.
- `publish` exists only with `MICA_MCP_PUBLISH=true` (`--allow-publish` for `mica mcp`). Without it, an agent saves drafts and a person publishes them.
- Each write sends the revision that the agent read, so an agent never overwrites a newer save.

## Consequences

- The tool names and their inputs are in the semver surface. `@micacms/mcp` itself is internal.
- The local entry points have no sign-in, for the reasons of [2](0002-a-local-editor-and-a-self-hosted-image.md).
- `upload_media` gets the file as base64 in the request, so the image holds an agent's upload in memory.
- `npx mica mcp` beside `npx mica start` is two processes on one working tree, with a short window between the revision check and the write. `/mcp` in `mica start` has no such window.
- Revisit when: agents need tools that the editor does not have, such as search or history.

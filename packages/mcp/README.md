# @micacms/mcp

> **Internal.** Published only because `@micacms/editor` installs it, and pinned
> exactly by it. Its API has no semver promise. The tools that it serves do:
> their names and inputs are public from 1.0.

The Mica tools for agents, over the [Model Context Protocol](https://modelcontextprotocol.io)
(revision 2026-07-28, and the 2025 revisions for older clients). One set of
tools on the runtime's services, and two transports:

- **stdio:** `npx mica mcp`, which an agent starts itself.
- **Streamable HTTP:** `/mcp`, in `npx mica start` and in the self-hosted image.

It has no authentication of its own. The composing app puts a gate in front of
`/mcp`: none in the loopback local editor, and the OAuth bearer gate of
`@micacms/auth-oidc` in the image (`MICA_MCP=true`).

## The tools

| Tool | What it does |
| --- | --- |
| `describe_model` | The collections, singletons and fields, and the format of each value. |
| `list_entries`, `get_entry`, `get_singleton` | The content, with the revision of each entry. |
| `find_references`, `list_media` | Links to an entry, and the media files. |
| `save_entry`, `save_singleton`, `delete_entry`, `reorder_entries` | Changes, as drafts. Each write sends the revision that the agent read. |
| `upload_media` | An image or a PDF, as base64, or a local file in the local editor. |
| `get_changes`, `discard_changes` | The drafts, and how to throw them away. |
| `publish` | Only with `MICA_MCP_PUBLISH=true` or `mica mcp --allow-publish`. |

Setup for a person is on the website: [Edit with an agent](https://mica.build/docs/agents/).

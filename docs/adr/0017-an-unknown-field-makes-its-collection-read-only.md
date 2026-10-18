# 17. A model that Mica cannot fully read makes it read-only, not stopped

**Status:** Accepted

## Context

A developer updates `@micacms/astro` with the site, and an operator updates the image on another day. A refusal to start locks out each editor because of one field. An older Mica that ignores an option can lose data on a save.

## Decision

- A field kind or option that this Mica does not know makes its collection or singleton read-only, with a notice that names the upgrade. All other parts stay editable. Writes and uploads to it are refused, and Publish refuses its pending changes.
- An unknown toolbar feature, and a default sort by a missing field, are left out with a warning.
- A manifest with a newer `protocolVersion` is refused.
- In the site's own build, an unknown kind or option is an error.
- When a new model in the repository cannot be read, the sync stops before it (`model_unreadable`), and Mica refuses each write with a 409 and "The content model changed, and this Mica cannot read it. Restart or upgrade Mica." Reads continue. The admin API and the MCP tools use the same check (`refuseWhileModelUnreadable`).

## Consequences

- An editor cannot change that collection until the image is upgraded. The versioning policy says: upgrade the image first, or at the same time.
- Revisit when: editors are often blocked by this. Then lock only the field, with a tested round trip of unknown values.

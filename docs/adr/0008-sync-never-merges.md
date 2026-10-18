# 8. Sync never merges, and Mica finds the conflicts itself

**Status:** Accepted

## Context

A server has no person to resolve a merge. In tests, Git's own refusal was not sufficient: a fast-forward replaced an untracked draft, and a local deletion undid an upstream edit, both without an error.

## Decision

- The clone fetches every `MICA_REPOSITORY_SYNC_SECONDS` (default 60), before each publication and on "Try again". It downloads the files of the new version first, outside the tree lock.
- Mica compares the upstream changes with the drafts for each group: an entry with its files, a singleton, or an order. It fast-forwards only when no group is on both sides. The unit is the group, because a check of single paths could mix one entry from two sides.
- A group on both sides is a conflict. The editor chooses "Keep my version" (the draft moves to the new head) or "Use the website's version" (the draft is discarded). The log names who chose.
- Mica never merges, rebases, stashes or pulls on the server.
- When the branch is rewritten (a force push or a reset), Mica puts the drafts aside, and a publication that never reached the host too. It moves the clone to the new head, writes the drafts back and shows them as conflicts. These conflicts are in memory only: after a restart, they show as plain drafts.

## Consequences

- One conflict stops the fast-forward for all editors until somebody chooses. The Dashboard, the Publish page and the entry show it.
- A new version whose LFS files do not download, or whose model this Mica cannot read, also stops the sync ([17](0017-an-unknown-field-makes-its-collection-read-only.md)).
- Change this decision when: conflicts on different fields of one entry are frequent. Then merge for each field.

# 35. What 1.0 does not do

**Status:** Accepted

## Context

A small scope is what one maintainer can keep stable. Each item below can come in a 1.x minor without a break. The "Scope and non-goals" page on micacms.com tells users how to work without them.

## Decision

1.0 does not have:

- Several sites, tenants or memberships in one process. One Mica manages one site. A hosted offering, if it comes, is a separate product that uses the published releases.
- Roles. Each admitted editor can do everything, Publish included.
- Drafts for each editor, approval workflows, scheduled publishing or named releases.
- A history and revert view. Git is the history.
- A blocks field with items of different shapes.
- A branch switcher. One Mica serves one branch.
- A `renamedFrom` field option. The rename recipe makes a rename one commit.
- Native multilingual content ([22](0022-no-native-multilingual-content.md)) and a self-hosted draft preview ([26](0026-preview.md)).

## Consequences

- Known gaps that are not decisions are GitHub issues with the label `known-gap`, not records.

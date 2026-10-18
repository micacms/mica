# 1. Git is the source of truth, and Mica keeps no database

**Status:** Accepted

## Context

A website's content needs one place of record. A CMS database beside Git gives two histories that can disagree, a second backup and a migration for each release.

## Decision

- The content is files in the website's Git repository. Git is the only history. Mica has no revision table, no retention rule and nothing to prune.
- Mica keeps no database. A draft is an uncommitted file in a Git working tree. The working tree holds exactly the current pending changes, never a second history.
- Mica stores no website history, sessions, accounts or memberships.
- A push to the branch starts the website build. Mica has no build webhook and no publish queue. A save does not start a build.
- Mica has no content API and no public media route. The website build reads the files. The editor's media route serves files, pending uploads included, only behind the access check of the editor.

## Consequences

- A copy of the repository is a copy of the published content. The drafts of a self-hosted Mica are on its volume ([7](0007-self-hosted-mica-keeps-its-own-clone.md)).
- The website changes only through its normal build.
- A route that serves a file without the access check is the forbidden public media route.

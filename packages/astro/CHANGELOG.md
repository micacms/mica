# Change Log - @micacms/astro

This log was last generated on Tue, 13 Oct 2026 04:44:02 GMT and should not be manually modified.

## 0.5.0
Tue, 13 Oct 2026 04:44:02 GMT

### Minor changes

- Ship setup guides for coding agents in `setup/`: a new or empty Astro project, and a project with content collections. https://micacms.com/setup.md sends an agent to them.
- The published manifest names `@micacms/astro` without a version, so a package update no longer changes it, and it records each collection's layout.
- `micaCollections()` refuses a field kind it does not know, so a typo in the model fails the build instead of making the collection read-only in Mica.

## 0.4.0
Sun, 11 Oct 2026 15:57:57 GMT

_Version update only_

## 0.3.0
Sat, 10 Oct 2026 18:31:39 GMT

_Version update only_

## 0.2.2
Sat, 10 Oct 2026 15:31:13 GMT

_Version update only_

## 0.2.1
Sat, 10 Oct 2026 14:58:49 GMT

_Version update only_

## 0.2.0
Mon, 31 Aug 2026 06:07:50 GMT

### Minor changes

- A larger refactor. Saves now land in a draft workspace and an explicit Publish writes them to the repository as one commit — a working tree under the local connector, a draft store behind the provider connectors. The editor split into composable packages: an authentication-neutral runtime, the admin SPA as built assets, a server-only OIDC gate, and two composition roots — `@micacms/editor` (`npx`, loopback, no authentication code at all) and `@micacms/self-hosted` (Docker, behind OIDC). `MICA_MODE` is gone: the mode is which app you run. `@micacms/model` was renamed to `@micacms/core`.


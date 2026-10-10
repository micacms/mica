# Change Log - @micacms/self-hosted

This log was last generated on Sat, 10 Oct 2026 18:31:39 GMT and should not be manually modified.

## 0.3.0
Sat, 10 Oct 2026 18:31:39 GMT

### Minor changes

- Drop the sessions table (migration 3): the database now holds only unpublished drafts. Everyone signs in once more after the upgrade.
- Require REPOSITORY=github or gitlab: a self-hosted Mica publishes only through a provider. REPOSITORY=local, the old default, now stops startup; use npx @micacms/editor to edit a checkout.

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


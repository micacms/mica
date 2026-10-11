# Change Log - @micacms/connectors

This log was last generated on Sun, 11 Oct 2026 15:57:57 GMT and should not be manually modified.

## 0.4.0
Sun, 11 Oct 2026 15:57:57 GMT

### Updates

- Security: refuse every content path that could leave the content root, in every connector and in the media routes; no write or delete can name the root itself
- Test the GitHub connector against a real scratch repository every week; GitLab follows when a token is configured.

## 0.3.0
Sat, 10 Oct 2026 18:31:39 GMT

_Version update only_

## 0.2.2
Sat, 10 Oct 2026 15:31:13 GMT

_Version update only_

## 0.2.1
Sat, 10 Oct 2026 14:58:49 GMT

### Patches

- Keep colocated media references working when an entry's URL changes.
- Keep a renamed entry in its place in the collection's manual order.

## 0.2.0
Mon, 31 Aug 2026 06:07:50 GMT

### Minor changes

- A larger refactor. Saves now land in a draft workspace and an explicit Publish writes them to the repository as one commit — a working tree under the local connector, a draft store behind the provider connectors. The editor split into composable packages: an authentication-neutral runtime, the admin SPA as built assets, a server-only OIDC gate, and two composition roots — `@micacms/editor` (`npx`, loopback, no authentication code at all) and `@micacms/self-hosted` (Docker, behind OIDC). `MICA_MODE` is gone: the mode is which app you run. `@micacms/model` was renamed to `@micacms/core`.


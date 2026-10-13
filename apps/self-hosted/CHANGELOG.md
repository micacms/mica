# Change Log - @micacms/self-hosted

This log was last generated on Tue, 13 Oct 2026 04:44:02 GMT and should not be manually modified.

## 0.5.0
Tue, 13 Oct 2026 04:44:02 GMT

### Minor changes

- Keep a Git clone of the content repository on the data volume instead of a SQLite draft store and the GitHub and GitLab APIs. Configure it with `MICA_REPOSITORY_URL` and `MICA_REPOSITORY_TOKEN` instead of `REPOSITORY`, `REPOSITORY_*`, `DATA_DIR` and `DATABASE_PATH`, check a setup with the `check` command, and resolve conflicts with changes made on the website. Any Git host over HTTPS should work; GitLab needs only `read_repository` and `write_repository`.

## 0.4.0
Sun, 11 Oct 2026 15:57:57 GMT

### Patches

- Security: in production, refuse to start without MICA_PUBLIC_URL; warn about MICA_* and REPOSITORY_* variables that nothing reads

### Updates

- Test that the sign-in callback is rate limited
- Test the sign-in refusal codes
- Security: /health checks only the process; the new /ready checks the database and the repository, cached for 30 s; neither shows the repository or the uptime
- Security: over https, prefix the session and CSRF cookies with __Host- and send Strict-Transport-Security; in production, refuse an http:// public URL except on loopback
- Require hono 4.13.7 and image-size 2.0.3, which fix published security advisories

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


# Change Log - @micacms/runtime

This log was last generated on Tue, 13 Oct 2026 04:44:02 GMT and should not be manually modified.

## 0.5.0
Tue, 13 Oct 2026 04:44:02 GMT

### Minor changes

- A field kind from a newer `@micacms/astro` no longer stops Mica: only its collection or singleton becomes read-only, writes and publications of it are refused with the reason, and `/admin/schema` reports it as `readOnly`.
- Edit and publish on a Git working tree in both apps. The content files (`contentFiles`, `ContentFiles` with `apply()`) and the content store move here from `@micacms/connectors`; Publish commits exactly the reviewed paths and refuses a file saved again after the review; an owner policy lets an app keep its own clone in step. The SQLite driver, the draft store and the provider connectors are removed, and `/ready` reports reason codes.

## 0.4.0
Sun, 11 Oct 2026 15:57:57 GMT

### Patches

- Security: keep a client's x-request-id only when it is short and plain, and send text media as UTF-8

### Updates

- Security: refuse an oversized request before reading it: 2 MiB for JSON, and at most 10 files of MAX_UPLOAD_BYTES per upload; the editor uploads in batches
- Security: with TRUST_PROXY, take the client address from the right-most X-Forwarded-For entry, and rate limit the sign-in callback
- Security: refuse every content path that could leave the content root, in every connector and in the media routes; no write or delete can name the root itself
- Add a Content-Security-Policy to every response, and serve the editor font from the admin instead of Google Fonts
- Security: refuse SVG uploads, do not list or serve SVG files, and serve every media file in a sandbox, as a download unless it is an image
- Security: /health checks only the process; the new /ready checks the database and the repository, cached for 30 s; neither shows the repository or the uptime
- Security: over https, prefix the session and CSRF cookies with __Host- and send Strict-Transport-Security; in production, refuse an http:// public URL except on loopback
- Require hono 4.13.7 and image-size 2.0.3, which fix published security advisories
- Correct a comment about sign-in rate limiting

## 0.3.0
Sat, 10 Oct 2026 18:31:39 GMT

### Minor changes

- Remove `sessions` from `OperationalInfo.database`: the self-hosted database no longer holds sessions.

## 0.2.2
Sat, 10 Oct 2026 15:31:13 GMT

_Version update only_

## 0.2.1
Sat, 10 Oct 2026 14:58:49 GMT

### Patches

- Show a URL change on the Publish page as one renamed entry, with only the changed fields.

## 0.2.0
Mon, 31 Aug 2026 06:07:50 GMT

### Minor changes

- The Publish page can show what a pending change does, as a before/after comparison rather than a diff: each changed field is one row with the stored value beside the staged one, worded by the field type — Yes/No for booleans, option labels for selects, file names for media, breadcrumbs into sections. The server gained `GET /api/admin/changes/compare`, which reads the same document from the repository and from the pending workspace — HEAD versus the working tree locally, the repository versus the draft overlay when deployed.
- A larger refactor. Saves now land in a draft workspace and an explicit Publish writes them to the repository as one commit — a working tree under the local connector, a draft store behind the provider connectors. The editor split into composable packages: an authentication-neutral runtime, the admin SPA as built assets, a server-only OIDC gate, and two composition roots — `@micacms/editor` (`npx`, loopback, no authentication code at all) and `@micacms/self-hosted` (Docker, behind OIDC). `MICA_MODE` is gone: the mode is which app you run. `@micacms/model` was renamed to `@micacms/core`.

### Updates

- Migrated the repository tooling from pnpm workspaces to Rush.


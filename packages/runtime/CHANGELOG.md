# Change Log - @micacms/runtime

This log was last generated on Sun, 25 Oct 2026 18:05:04 GMT and should not be manually modified.

## 0.14.0
Sun, 25 Oct 2026 18:05:04 GMT

### Minor changes

- The preview image tells Mica its state and its last 50 lines of output on port 4380 inside the network, without credentials and tokens. The self-hosted editor shows the exact state in its menu, the reason when the preview failed, and the lines on the System page. Without that port, as with an image of one's own, Mica guesses as before.
- The System page of the self-hosted editor lists the last warnings and errors since Mica started, kept in memory only, with email addresses hidden; "Copy report" adds the newest 20 of them.
- The self-hosted Mica can run on demand: before it stops, it tries once more to push a publication that waits, and after a start, the preview image waits up to 30 seconds for Mica's first sync, so that it copies the newest website once.
- The self-hosted editor shows the state of its preview: live while the preview container answers, starting for five minutes without an answer, then stopped, and off without `MICA_PREVIEW_UPSTREAM`.

## 0.13.0
Sat, 24 Oct 2026 13:39:21 GMT

### Minor changes

- The live preview of the self-hosted Mica has an image of its own: ghcr.io/micacms/preview installs and runs the website from Mica's clone, and follows each sync. A self-hoster writes no Dockerfile for it.
- The self-hosted image can show the live preview: the website's astro dev runs in a container of its own on the drafts, and Mica lets only the signed-in editors in, on the name preview.<the editor's name> on Mica's own port. MICA_PREVIEW_UPSTREAM turns it on; MICA_PREVIEW_URL sets another name.

### Patches

- The editor's Content-Security-Policy allows frames from the origins of the live preview, and from no other.

### Updates

- The image and the preview image use the current Node 24 base images.

## 0.12.0
Mon, 19 Oct 2026 07:02:35 GMT

### Minor changes

- A domain rule (`MICA_ADMIT_DOMAINS`) with Google now also needs the account's Workspace domain (the `hd` claim) to be an admitted domain. Google reports a personal account with a company address as verified, so before this, such an account could get in, also after the company removed the person. This tightens admission: a personal Google account needs `MICA_ADMIT_EMAILS`. Put the primary domain of your Workspace in `MICA_ADMIT_DOMAINS`. Editors who sign in with Google through a domain rule must sign in again after the upgrade.
- A full or read-only disk gives a clear message that asks the person who runs Mica to act, and the log names it, instead of "Something went wrong".

### Patches

- The consent page for an agent accepts Allow only one second after it opens, and Mica refuses a sooner one, so that a click hidden behind a pop-up window cannot allow an agent (double-clickjacking). The address check of a client document refuses more IPv6 ranges, and a loopback redirect address must not have a fragment or a user name.

## 0.11.0
Sun, 18 Oct 2026 06:05:29 GMT

### Minor changes

- Support content in a Git submodule of the website repository: when the content repository is on a detached HEAD, the status names the command that checks out the branch, and Publish refuses before it commits.
- The Content-Security-Policy follows the model: only when a coordinates field has a map does it allow the map's hosts for images and connections, and blob: workers. Without a map, it stays same-origin.
- MICA_SITE_URL is the website's address; with a url in the model, the schema gives the editor each page's address.
- Support Git LFS under the content root: Publish sends the LFS files with git lfs push before the push, also from a checkout without the LFS pre-push hook, and the media routes say when a file is an LFS pointer that was not downloaded.
- The preview route gives the address of a dev server that shows the drafts, when the app has one.
- Uploads take GPX, KML, GeoJSON, ZIP and CSV files, each checked from its bytes, and only the types of the field.
- The schema names the reference sets, and a route gives the items of one from its index.
- While a newer content model cannot be read, every write is refused with a 409 that says why, so that a save no longer leaves out the new fields. A content error gets its own status: 409 for a conflict, 422 for an invalid value or a file that cannot be read, 404 for an unknown collection or singleton, and 400 for the rest. The change list names the group of each change. The response types are exported for the editor, the owner policy is required, and the developer policy and MICA_LOCAL_PUBLISH move to the local editor.
- Publish takes a new file along that a link in rich text names, such as a new PDF in the shared folder, and refuses to publish the deletion of a file that rich text links to, or of an entry whose media another entry uses. A save of settings with a malformed body is refused. The list of entries no longer takes ?search=, which nothing used. classifyPath moves to @micacms/core, and exports that nothing used are removed: actorOf, adminAssetsExist, badRequest, checkChangePaths, ContentError, createMediaService, DEFAULT_BASE_URL, DEFAULT_SITE_ID, developerEnvironment, editorOf, FilesError, headRevision, headSource, inRepo, LITERAL, notFound, ReadOnlyError, requestContext, schemaStats and UnknownContentError.

### Updates

- Run the tests without a build first. The OIDC gate and the self-hosted app run their tests the same way, and the image build keeps its dependency install when only a change file is new.

## 0.10.0
Thu, 15 Oct 2026 04:37:22 GMT

### Minor changes

- The self-hosted image can let agents connect at /mcp with MICA_MCP=true. Mica is their OAuth server: a person signs in as for the editor and allows each agent on a consent page, and Mica stores no tokens. MICA_MCP_PUBLISH lets a person also allow an agent to publish.

## 0.9.0
Wed, 14 Oct 2026 11:51:45 GMT

### Minor changes

- /ready has the status degraded (HTTP 200) when something needs a person, and lastSyncAt.
- A Git call can have its own time limit. SyncStatus has no restartRequired any more.
- Saves keep undeclared keys and `.mdoc` files, and a URL change moves every file of the entry. A singleton without a file opens with its defaults.
- `checkSchema` and `readOnlyParts` moved to `@micacms/core` (`readManifest`).
- Self-hosted sign-in: `MICA_SESSION_SECRET` is always required. `MICA_SIGNIN_WINDOW_MS` is now `MICA_SIGNIN_WINDOW_MINUTES`. Plain-HTTP discovery is allowed only for an issuer on this machine.
- `NODE_ENV` is no longer read: plain HTTP and a write without an Origin header are allowed only for an address on this machine. `MICA_PUBLIC_URL` must be an origin without a path. `MICA_ADMIN_ORIGINS` and `MICA_ADMIN_DIR` moved to the local editor. `isProduction` is now `isLoopback`.
- No whole media file in memory: an upload is one file that streams to disk, the file route streams, revisions are cached streamed hashes, and a URL change copies media on disk. ContentFiles has readHead, readStream and receive instead of readBinary, and apply returns what its after callback reads under the lock.
- Read and write every entry and singleton in its own folder. Opening an entry no longer lists its collection.

### Patches

- When Publish waits for commits that no remote has, it names git push -u origin HEAD for a branch without an upstream.
- Discard, Delete and Reorder check the revision that the editor saw, as Publish does: a colleague's later save is a conflict (409), not lost. The comparison returns the revisions of the files it shows.
- Security: the content files refuse a symbolic link out of the content root; a route slug is one folder name; a name such as `constructor` is not a collection (400, not 500); `headSource` paths go through `contentPath`; an upload request carries at most 4 files, prepared one after another; the media route removes only its own prefix.
- The Publish page shows an entry with no "before" while the published version still names repeater rows by number.
- Publish reads unchanged files from the working tree and only the drafts that stay behind from Git: a deletion no longer starts one Git process for each file of the site.

### Updates

- The sign-in code exports its discovery, for the check command of the self-hosted image.
- Import the internals of @micacms/core from @micacms/core/internal.

## 0.8.0
Tue, 13 Oct 2026 19:37:59 GMT

### Minor changes

- Opening an entry, the free-URL check, the dashboard, the System page and the change list read only what they show; the media file route answers 304 with an ETag
- Breaking: ContentFiles has stat(); the media list reads no file and has no dimensions, which /admin/media/info gives for one file; a single entry's response has no position

### Updates

- Comments only
- Uses the rich-text path rules from @micacms/core

## 0.7.0
Tue, 13 Oct 2026 14:06:11 GMT

### Minor changes

- Breaking: findReferences also returns settings pages, as { kind: 'entry' | 'singleton', ... }; a save with updateLinks moves the links to a renamed entry along, and a URL change and those links are published together
- The media usage and delete routes: a file that no field and no rich text uses can be deleted, as a pending change
- An upload from an entry's form goes into that entry's media folder, and a new entry's uploads move with its URL at the first save; videos are refused
- A new content model is used without a restart: the runtime checks the manifest on admin requests and before Publish, and keeps the model in use when the new one cannot be read
- Breaking: Publish commits only the chosen changes, together with the new entries and files they use; Save no longer checks required fields, and Publish does; each publication's commit ends with the trailer 'Published-with: Mica'; the staging status reports unpublished commits as 'unpushed' instead of 'ahead'
- The local editor's Publish refuses while the branch holds other commits that no remote has, so it never sends a developer's own commits

### Patches

- A save with keepMine is logged with the editor's identity
- Publish, Discard and conflict choices are logged with the editor's identity, without content

## 0.6.0
Tue, 13 Oct 2026 11:14:11 GMT

### Minor changes

- `layoutProblems` lists the entries in the other layout; the local editor refuses to start on any, and a list request that meets one answers 409 with the files.
- Publish refuses a change set that would leave a broken relation or a missing media file: a changed document that links to nothing, or a deleted entry or file that another document still uses. The delete warning also finds relations in nested fields.
- Breaking: every Mica configuration variable starts with `MICA_`: `MICA_LOG_LEVEL`, `MICA_CONTENT_ROOT`, `MICA_MAX_UPLOAD_BYTES`, `MICA_TRUST_PROXY`, `MICA_ADMIN_ORIGINS` and `MICA_ADMIN_DIR`. The old names are not read. `MICA_CONTENT_ROOT` has no default any more.
- Breaking: requires Node 24 or newer.
- Internal: removed unused exports (`ulid`, `isUlid`, `intParam`, `validationFailed`, `RateLimiter.reset` and the `invalid_credentials` error code). The README states that the package is internal.
- Breaking: an image field refuses HEIC files, because Astro cannot process them. Convert them to JPEG first.

### Patches

- Publish in the local editor pushes a new branch to `origin` and sets its upstream; without a remote, the message names the command.

### Updates

- Tests for a media value with alt text.

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


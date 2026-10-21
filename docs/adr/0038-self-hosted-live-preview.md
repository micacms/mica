# 38. A live preview for the self-hosted Mica, on an origin of its own

**Status:** Accepted. Replaces the decision of [37](0037-live-preview.md) for the self-hosted Mica.

## Context

Editors of a self-hosted Mica need the live preview of the local editor ([37](0037-live-preview.md)). Their drafts are uncommitted files in Mica's clone ([7](0007-self-hosted-mica-keeps-its-own-clone.md)), so only a dev server that reads that clone can show them. `astro dev` runs the website's code and its packages. Code from the repository must not meet Mica's secrets ([10](0010-git-on-the-server-is-isolated.md)), and the image has no package manager and a read-only file system. The website's scripts, such as analytics, must not get the editor's rights.

## Decision

- A second container runs `MICA_PREVIEW=1 astro dev`: Mica's preview image (`ghcr.io/micacms/preview`) mounts Mica's volume read-only, copies the website from the clone without its content root, links the clone's content root in its place, installs with the site's lock file, and starts the dev server. When a sync or a publication changes the clone's commit, it copies again; it installs again only when the lock file changed, and restarts the dev server only when a file changed. It removes only files that it copied, and it refuses a writable volume. The container gets none of Mica's secrets, and Mica's image does not change. A website that needs another Node version, a private registry or Bun runs an image of its own with the same mount and variables.
- The preview has an origin of its own on the same site as the editor, with another host name, such as `https://preview.cms.example.com` beside `https://cms.example.com`: a browser sends the editor's cookies to each port of its host. `MICA_PREVIEW_UPSTREAM`, the dev server in the network, turns the preview on. Its name is the editor's with `preview.` in front, unless `MICA_PREVIEW_URL` names another. A gate in the Mica process takes the requests for that name on Mica's own port, so a reverse proxy only adds the name. It forwards the requests, and the WebSocket of Vite's reload, to the dev server.
- The gate lets in only the editor's browser. `/api/admin/preview`, behind the sign-in, gives a token for the signed-in person that is valid for one minute. The editor posts it to the preview's origin, and the gate answers with a cookie of that origin for ten minutes. The editor gets a new token while the preview shows. The gate takes its cookie off each request before it forwards it, and only the editor's origin can frame a page.
- The dev server of the preview container does not write into the content root.
- Mica does not start, stop or build the preview, and a save starts no build ([1](0001-git-is-the-source-of-truth.md)): the dev server sees the files change, as in the local editor.

## Consequences

- A change of a template shows in the preview after Mica's next sync, a few seconds after the dev server starts again.
- The preview runs the code of the branch, as the website's build in CI does, and it needs the npm registry. Its first start installs the packages for some minutes; a cache volume makes a restart take seconds. The image has no Bun, no Yarn Plug'n'Play, no `git` and no compiler, and content in a Git submodule ([12](0012-content-in-a-git-submodule.md)) leaves no website in Mica's clone: such a site runs an image of its own.
- An operator runs one more container, and gives the preview a second name with TLS behind a reverse proxy that passes WebSockets and the browser's `Host` header.
- The preview's origin must be on the same site as the editor. Else browsers block its cookie as a third-party cookie.
- A person whom the admission rules no longer admit gets no new token, and keeps the preview for ten minutes at most.
- `MICA_PREVIEW_UPSTREAM`, `MICA_PREVIEW_URL`, the derived name and the preview image's mount, variables and port are in the image contract of [30](0030-semver-covers-the-public-surface.md).
- A hosted offer can use the same parts: the gate chooses by host name behind one wildcard ingress, and the preview runs beside Mica in the same pod.
- Change this decision when: the website's framework can show drafts without a dev server, or one preview must serve several sites.

# 38. A live preview for the self-hosted Mica, on an origin of its own

**Status:** Accepted. Replaces the decision of [37](0037-live-preview.md) for the self-hosted Mica.

## Context

Editors of a self-hosted Mica need the live preview of the local editor ([37](0037-live-preview.md)). Their drafts are uncommitted files in Mica's clone ([7](0007-self-hosted-mica-keeps-its-own-clone.md)), so only a dev server that reads that clone can show them. `astro dev` runs the website's code and its packages. Code from the repository must not meet Mica's secrets ([10](0010-git-on-the-server-is-isolated.md)), and the image has no package manager and a read-only file system. The website's scripts, such as analytics, must not get the editor's rights.

## Decision

- A second container runs `MICA_PREVIEW=1 astro dev` from a preview image that the developer builds from the website project: the site's code and its packages. Only the content root comes from Mica's volume, read-only. The container gets none of Mica's secrets, and Mica's image does not change.
- The preview has an origin of its own on the same site as the editor, with another host name, such as `https://preview.cms.example.com` beside `https://cms.example.com`: a browser sends the editor's cookies to each port of its host. `MICA_PREVIEW_URL` names it, and `MICA_PREVIEW_UPSTREAM` names the dev server in the network. A gate in the Mica process answers on that origin. It forwards the requests, and the WebSocket of Vite's reload, to the dev server.
- The gate lets in only the editor's browser. `/api/admin/preview`, behind the sign-in, gives a token for the signed-in person that is valid for one minute. The editor posts it to the preview's origin, and the gate answers with a cookie of that origin for ten minutes. The editor gets a new token while the preview shows. The gate takes its cookie off each request before it forwards it, and only the editor's origin can frame a page.
- The dev server of the preview container does not write into the content root.
- Mica does not start, stop or build the preview, and a save starts no build ([1](0001-git-is-the-source-of-truth.md)): the dev server sees the files change, as in the local editor.

## Consequences

- A change of a template shows in the preview after a new preview image, as it shows on the website after a deploy.
- An operator runs one more container, and gives the preview a second name with TLS behind a reverse proxy that passes WebSockets.
- The preview's origin must be on the same site as the editor. Else browsers block its cookie as a third-party cookie.
- A person whom the admission rules no longer admit gets no new token, and keeps the preview for ten minutes at most.
- `MICA_PREVIEW_URL`, `MICA_PREVIEW_UPSTREAM`, `MICA_PREVIEW_PORT` and the gate's port are in the image contract of [30](0030-semver-covers-the-public-surface.md).
- Change this decision when: the website's framework can show drafts without a dev server, or one preview must serve several sites.

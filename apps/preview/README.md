# @micacms/preview

The image of the live preview of the self-hosted Mica
([ADR 38](../../docs/adr/0038-self-hosted-live-preview.md)): it runs the
website's `MICA_PREVIEW=1 astro dev` from Mica's clone, on its drafts. Mica's
gate forwards the preview's host name to it. It is not published to npm: it
ships only as `ghcr.io/micacms/preview`, the target `preview` of the
repository's `Dockerfile`.

## What it does

1. It waits for Mica's clone in `/mica/repository` (Mica's volume, mounted
   read-only), and finds the content root as Mica does.
2. It waits up to 30 s for Mica's first sync after Mica's start: Mica writes
   `syncedAt` into its `lease.json` on the volume. Thus, when both start
   together, it copies the newest website once.
3. It finds the website: the nearest folder with an `astro.config.*` above the
   content root.
4. It copies the repository into `/work`, without `.git` and the content root,
   and links the clone's content root in its place, so that each draft is there
   at once.
5. It installs with the lock file at or above the website: `npm ci`,
   `pnpm install --frozen-lockfile` or `yarn install`. The caches are in `/cache`.
6. It starts `astro dev` on port 4321, with `MICA_PREVIEW=1` and
   `MICA_PREVIEW_EDITOR` from `MICA_PUBLIC_URL`.
7. Every five seconds it reads the clone's commit. When a sync or a publication
   changes it, it copies again. It installs again only when the lock file
   changed, and starts the dev server again only when a file changed.
8. After a failure, such as an install while the registry is away, it tries
   again after 30 s, then after longer waits up to ten minutes, or at once at
   the next change of the website.

Mica's volume must be read-only: the image refuses to start when it can write it.
It removes only the files that it copied itself, so files that an install
generates outside `node_modules` stay.

## Variables

| Variable | Effect |
| --- | --- |
| `MICA_PUBLIC_URL` | The editor's address. The page script answers only that editor. |
| `MICA_CONTENT_PATH` | The content root, when the repository has more than one. As for Mica. |
| `MICA_PREVIEW_SITE_PATH` | The website's folder in the repository, when no `astro.config` is above the content root. |

The other variables of the container reach the dev server, for a website that
reads its own.

## Limits

- Node 24. npm, pnpm and Yarn through corepack; not Bun, and not Yarn's
  Plug'n'Play (`nodeLinker: node-modules` works).
- It needs the npm registry. The first start installs for some minutes.
- No `git` and no compiler: a package from a Git URL, or one that builds native
  code from source, does not install.
- The clone has symbolic links as plain files, and Git LFS files outside the
  content root as pointer files.
- With the content in a Git submodule, Mica's clone has no website.

A website that needs more runs an image of its own with the same mount and
variables. See the self-hosting guide on micacms.com.

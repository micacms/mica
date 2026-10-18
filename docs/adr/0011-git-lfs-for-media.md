# 11. Git LFS holds the media that the site owner gives to it

**Status:** Accepted

## Context

A site with thousands of photos makes a plain Git repository too large: each clone holds each version of each file. GitHub, GitLab and Forgejo serve Git LFS with the same token as Git.

## Decision

- Mica supports Git LFS for files under the content root. The site owner sets the LFS paths in `.gitattributes`. Mica never writes that file.
- On the server, Git LFS is the only filter driver, with `required`. `lfs.url` and `lfs.pushurl` are `<clone URL>.git/info/lfs` (with one `.git`), or `MICA_REPOSITORY_LFS_URL`, and they override `.lfsconfig`, because `.lfsconfig` is repository content. The same credential helper answers Git LFS.
- The clone downloads only the LFS files under the content root. A sync downloads them before the fast-forward; a failed download stops the sync.
- Hooks are off, so Mica runs `git lfs push` before each `git push`, in both apps. A refused LFS push turns the publication back into drafts.
- The local editor and `mica mcp` stop at start when `.gitattributes` gives content files to LFS and Git LFS is not set up.
- The media routes give a clear error for a pointer file that was not downloaded.

## Consequences

- The image contains `git-lfs`. The volume holds each LFS file twice: in `.git/lfs` and in the working tree.
- The website build must check out with LFS, such as `lfs: true` in `actions/checkout`.
- LFS storage counts against the host's quota. `check` cannot prove LFS write access; the first publication shows a refusal.
- With `MICA_REPOSITORY_LFS_URL` on another host, that host also gets the token.

# 9. Publish commits the reviewed paths

**Status:** Accepted

## Context

A check of HEAD would refuse a publication after each upstream push, also of code. A commit and a push are two steps, and either can fail.

## Decision

- Publish sends each reviewed path with the revision that the editor saw. Mica commits exactly those paths. It refuses only when one of them, or another file of the same entry, changed since.
- The summary of the publication is the commit message. The editor is the author, Mica the committer.
- **Self-hosted:** the clone has at most one unpushed commit. Mica pushes it with an explicit refspec and never forces. A push refused as non-fast-forward is undone; the clone catches up, Mica checks the drafts again and makes the same commit again. A push that the host refuses (a protected branch, a hook, a token without write access) turns the commit back into drafts and shows the reason. A network or sign-in failure keeps the commit, and the next sync tries again.
- **Local:** the local editor runs the `git` binary, with the developer's SSH agent, credential helper and remotes. The path list limits `git add` and `git commit`; Mica never runs `git add -A`. Each commit ends with `Published-with: Mica`, and Publish refuses while a developer's own commit waits to be pushed. A failed push gives `committed-pending-push`, and a retry pushes without a new commit. `MICA_LOCAL_PUBLISH=false` turns Publish off.

## Consequences

- A developer's unrelated work in the same checkout never goes into an editor's commit.
- Mica classifies a push failure from Git's output in a fixed order, because a 403 page also contains the network pattern.
- The local editor needs `git` on the path.

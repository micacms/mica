# 7. A self-hosted Mica keeps its own Git clone

**Status:** Accepted

## Context

Provider APIs were slow, rate-limited and different for each host. A working tree gives one model for drafts in both apps, with no database.

## Decision

- The self-hosted Mica clones `MICA_REPOSITORY_URL` into `MICA_DATA_DIR/repository`: `git clone --filter=blob:none --single-branch`, with the whole current tree checked out. It does not use a sparse checkout.
- One Mica uses one volume. A lease file with a heartbeat names the process. A second process waits until the lease expires (30 seconds without a heartbeat), then refuses. With the lease, the start removes the Git lock files that a stop left.
- Before a fast-forward, Mica writes `MICA_DATA_DIR/operation.json` with the two commits. A start that finds it finishes the fast-forward: it restores each changed path and moves the branch.
- A clone for another branch is removed only when it holds no draft and no unpushed commit. Otherwise Mica does not start and says how to get the work out. A new URL keeps the clone.
- `compact` makes a new clone when the clone holds no work, so the volume gets smaller.
- The start serves with the model at the clone's head, and syncs in the background.

## Consequences

- The volume holds the drafts. Back it up.
- The volume needs about twice the size of the current content, and grows with media changes.
- A sparse clone was tested and let a fast-forward overwrite an untracked draft without an error. A 5,000-file, 2 GB repository cloned in 18 seconds.
- Revisit when: the media of a site is larger than a full checkout can hold. Git LFS keeps the history small, not the checkout ([11](0011-git-lfs-for-media.md)).

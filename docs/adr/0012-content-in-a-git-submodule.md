# 12. The content can be in a Git submodule

**Status:** Accepted

## Context

Some sites keep the content in its own repository, so that its history, size and access rights are separate from the code. A commit on a detached HEAD is on no branch, and the next `git submodule update` hides it.

## Decision

- The content root can be in a submodule of the website repository: at its top, or in a folder of it. Mica works in the repository that holds the content root, and never commits in the website repository.
- The local editor finds the repository with `git rev-parse --show-toplevel` in the content root.
- On a detached HEAD, the start banner and the Publish page give the command that checks out the branch, and Publish refuses before it commits.
- Mica never changes the submodule pointer. The website build gets the newest content itself, such as with `git submodule update --remote`.
- The loader writes `.mica/schema.json` into the submodule. The developer commits it there.
- A self-hosted Mica clones the content repository and never fetches submodules.

## Consequences

- The website shows a publication only after its build gets the new content.
- A self-hosted Mica needs the content in a folder of the content repository ([16](0016-the-manifest-is-committed.md)). The local editor accepts both.

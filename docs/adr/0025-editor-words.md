# 25. The editor speaks of saving and publishing, not of Git

**Status:** Accepted

## Context

Editors are not developers. An editor who reads "push" or "branch" thinks that the tool is not for them.

## Decision

- The editor uses editing words: "Say what changed", not "commit message"; "Published", not "committed"; "not on the website yet", not "not pushed".
- Git words (commit, push, branch, repository, working tree, hash) appear only on the System page and in a closed "Details for developers" element.
- Server messages that reach editors follow the same rule. `editor-ui/test/words.test.ts` finds Git words in the components.

## Consequences

- The local editor uses the same words, also for developers. When a message needs a Git command, the command is in the message.
- CLI output and the developer docs keep the Git words.

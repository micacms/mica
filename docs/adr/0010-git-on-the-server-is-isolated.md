# 10. Git on the server is isolated, and the token never touches the disk

**Status:** Accepted

## Context

Another person controls the repository. Git has many ways to run code from repository content: hooks, filters, configuration and symlinks.

## Decision

- The clone's `git` runs with an allowlisted environment, never `process.env`, which holds the session and OIDC secrets.
- Every setting comes from `GIT_CONFIG_*`: no system or global configuration, hooks off, symlinks as plain files, `autocrlf` off, attributes that turn off conversion, `ident` and encoding, no filter driver except Git LFS ([11](0011-git-lfs-for-media.md)), only the `https` transport (plain `http` only on the same computer), no submodules, literal pathspecs, `safe.directory` set, and gc only after a fetch.
- A credential helper for the configured host and port gives the token, after an empty `credential.helper` clears all others. The token is never in a URL or in `.git/config`. Logs and errors show cleaned URLs.

## Consequences

- The Git token needs fewer rights than an API token: on GitHub "Contents: read and write"; on GitLab `read_repository` and `write_repository`, with a role that can push to the branch.
- Tests showed that a helper without a host gives the token to every host, and that `ident` changes bytes at checkout.

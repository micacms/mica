# 13. Any Git host over HTTPS; supported means live-tested

**Status:** Accepted

## Context

The self-hosted Mica uses no provider API, so each Git host over HTTPS can work. A promise needs a test.

## Decision

| Tier | Hosts |
| --- | --- |
| Supported, live-tested every week | github.com, gitlab.com |
| Tested in CI | Forgejo (`tests/oidc`) |
| Expected to work, not tested | Bitbucket Cloud, Gitea, GitHub Enterprise Server, self-managed GitLab |

`live-git.yml` runs the live suite each week against scratch repositories.

## Consequences

- A defect on a host that is not tested is fixed when somebody reports it.
- github.com and gitlab.com are supported only while the live runs pass without a skip.
- Only HTTPS remotes work. SSH deploy keys and a private CA are not supported.
- Change this decision when: an adopter on a self-managed host gives the live suite a scratch project there.

# 32. 1.0 ships after four weeks of release candidates on real websites

**Status:** Accepted

## Context

A real website finds what CI cannot: a provider, an identity provider and a host in combination.

## Decision

- `1.0.0-rc.N` is published under the npm dist-tag `next`, and the image without `latest`.
- 1.0.0 ships when one or two real websites, if possible of different kinds, have run on the release candidates for at least four weeks, and at least one of them through the self-hosted image. The maintainer's own websites count; the example and `sites/micacms` alone do not. An external website also counts.
- A fix gives a new `rc.N` and keeps the time. A break of a public surface starts the four weeks again.

## Consequences

- The release date does not depend on a volunteer.

- When the evidence comes from the maintainer, gaps in the docs stay less visible. Clean-machine runs of the getting-started and self-hosting guides cover this.

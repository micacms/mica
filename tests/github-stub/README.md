# GitHub API stub

A stand-in for the GitHub REST API, for the test stacks in
[`tests/oidc/`](../oidc/README.md) and [`tests/e2e/`](../e2e/README.md). A
self-hosted Mica publishes only through a provider, so a test stack needs one
that runs without a network or a secret.

[`server.mjs`](server.mjs) is one Node file with no dependencies. It answers
exactly the calls the GitHub connector makes — the contents API for reads, and
blobs, trees, commits and refs for a publication — against an in-memory
repository seeded from a directory. A ref update that is not a fast-forward is
refused, like GitHub refuses it.

| Variable    | Default   | Meaning                                       |
| ----------- | --------- | --------------------------------------------- |
| `PORT`      | `8787`    | Where it listens                              |
| `SEED_DIR`  | `/seed`   | The directory that becomes the first commit   |
| `SEED_ROOT` | `content` | Where that directory sits in the repository   |
| `BRANCH`    | `main`    | The one branch                                |

Point Mica at it with `REPOSITORY=github`, any `REPOSITORY_PROJECT` and
`REPOSITORY_TOKEN`, and `REPOSITORY_API_BASE=http://localhost:8787`.

It is not a GitHub emulator. Anything the connector does not call answers 404,
and nothing is stored when it stops.

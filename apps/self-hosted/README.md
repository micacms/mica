# @micacms/self-hosted

> **Not published to npm.** It ships only as the image
> `ghcr.io/micacms/mica`; this package is how the image is built.

The self-hosted Mica composition — what the Docker image runs. It composes
`@micacms/runtime` and `@micacms/editor-ui` behind the OIDC gate from
`@micacms/auth-oidc`, and works on its own Git clone of the content repository.
The clone lives in `MICA_DATA_DIR/repository`. Its working tree is the draft
workspace: work that is saved and not yet published is uncommitted files. There
is no database. Mica fetches and fast-forwards the clone, and Publish commits
and pushes over HTTPS with `MICA_REPOSITORY_URL` and `MICA_REPOSITORY_TOKEN`.
Any Git host that serves HTTPS should work. Git runs with an isolated
configuration and a scoped credential, so the repository cannot run code on
the server.

Deploying it is documented in
[docs/self-hosting.md](../../docs/self-hosting.md): one container, an OIDC
provider you already have, a repository token, and an admission rule saying
who may edit. `docker compose run --rm mica check` tests the token, the push
rights and the content model before the first start. The server refuses to start without the last one — a deployment
that admits everybody its issuer knows is a misconfiguration, not a default.

Running Mica on your own machine needs none of this: `npx @micacms/editor start`.

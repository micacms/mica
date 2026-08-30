# @micacms/self-hosted

> **Experimental.** Pre-1.0: APIs and the content format can still change
> without notice. Use it at your own risk.

The self-hosted Mica composition — what the Docker image runs. It composes
`@micacms/runtime` and `@micacms/editor-ui` behind the OIDC gate from
`@micacms/auth-oidc`, reaches the content repository through
`@micacms/connectors`, and keeps one SQLite database: sessions, and — behind a
GitHub or GitLab repository — the draft store holding work that is saved and
not yet published.

Deploying it is documented in
[docs/self-hosting.md](../../docs/self-hosting.md): one container, an OIDC
provider you already have, a repository token, and an admission rule saying
who may edit. The server refuses to start without the last one — a deployment
that admits everybody its issuer knows is a misconfiguration, not a default.

Running Mica on your own machine needs none of this: `npx @micacms/editor`.

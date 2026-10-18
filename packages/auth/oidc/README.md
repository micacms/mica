# @micacms/auth-oidc

> **Internal, not published.** The self-hosted image builds it from source.

The server-only OIDC gate for Mica: the authorization code flow with PKCE,
sessions in an encrypted cookie, admission rules over provider claims, and the middleware
gate the runtime mounts in front of the admin API.

`src/oauth/` makes Mica the OAuth 2.1 authorization server of its own `/mcp`,
for agents: Client ID Metadata Documents and a stateless registration, a
consent page after the editor's sign-in, sealed tokens that Mica does not
store, and the bearer gate in front of `/mcp`.

It is a dependency of `@micacms/self-hosted` and of nothing else. In
particular, the local editor (`@micacms/editor`) must never gain a path to
this package — that absence is the product boundary that keeps
`npx @micacms/editor` free of authentication code, and a test walks the
dependency graph to enforce it.

Mica implements no passwords, no reset flow, no MFA and no passkeys, in here
or anywhere: an external identity provider does all of it better.

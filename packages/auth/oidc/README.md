# @micacms/auth-oidc

> **Internal, not published.** The self-hosted image builds it from source.
> Versions up to 0.8 are on npm, deprecated.

The server-only OIDC gate for Mica: the authorization code flow with PKCE,
sessions in an encrypted cookie, admission rules over provider claims, and the middleware
gate the runtime mounts in front of the admin API.

It is a dependency of `@micacms/self-hosted` and of nothing else. In
particular, the local editor (`@micacms/editor`) must never gain a path to
this package — that absence is the product boundary that keeps
`npx @micacms/editor` free of authentication code, and a test walks the
dependency graph to enforce it.

Mica implements no passwords, no reset flow, no MFA and no passkeys, in here
or anywhere: an external identity provider does all of it better.

# @micacms/auth-oidc

> **Internal.** Published only because the Mica apps install it, and pinned
> exactly by them. It has no semver promise: any release can break its API. Use
> `@micacms/core`, `@micacms/astro` or the `@micacms/editor` CLI instead.

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

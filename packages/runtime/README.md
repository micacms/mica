# @micacms/runtime

> **Internal.** Published only because the Mica apps install it, and pinned
> exactly by them. It has no semver promise: any release can break its API. Use
> `@micacms/core`, `@micacms/astro` or the `@micacms/editor` CLI instead.

The single-site Mica runtime: the Hono API, application services, the content
files and the Git working-tree code (Git runner, locks, owner policy), deliberately **authentication-neutral**. It answers "who is
this request?" with whatever `AuthSurface` the composing app hands in, and
never imports an auth implementation — that direction is what keeps
`npx @micacms/editor` free of authentication code.

You normally do not depend on this package directly. The two compositions do:

- [`@micacms/editor`](https://www.npmjs.com/package/@micacms/editor) — the
  local editor: loopback, no auth, no database.
- [`@micacms/self-hosted`](https://www.npmjs.com/package/@micacms/self-hosted)
  — the Docker composition, behind `@micacms/auth-oidc`.

# @micacms/editor-ui

> **Internal, not published.** `@micacms/editor` ships this build in its
> `dist/admin`, and the self-hosted image builds it from source. Versions up to
> 0.8 are on npm, deprecated.

The Mica editor SPA — the Vue administration UI, shipped as **built assets**
in `dist/` and served by a composing app (`@micacms/editor` locally,
`@micacms/self-hosted` behind OIDC). It is identity-neutral: everything it
renders is generated from the content model the server publishes, and whether
a sign-in exists at all is the server's `/api/auth/config` answer, not the
bundle's.

There is no OIDC client code, token handling or provider asset in here —
authentication is a server-side cookie the browser never inspects, and the
local editor's boundary tests grep this package's build to keep it that way.

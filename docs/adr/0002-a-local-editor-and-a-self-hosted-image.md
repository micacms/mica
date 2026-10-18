# 2. A local editor without sign-in, and a self-hosted image behind OIDC

**Status:** Accepted

## Context

A developer must be able to run the editor without an identity provider. A team needs an editor on a server, with sign-in. Mica must not own passwords: that means reset, MFA, passkeys and breach response.

## Decision

- `@micacms/editor` (`apps/local-editor`) is the local editor. It has no identity provider, no user and no sign-in. Its access policy allows every action.
- The local editor listens only on loopback and refuses every other address. No flag changes this. It answers only to the `Host` names `localhost`, `127.0.0.1` and `[::1]`, against DNS rebinding, and its Origin check refuses a write from another origin.
- The local editor contains no authentication code. `apps/local-editor/test/boundary.test.ts` checks the dependency graph, the imports and the browser bundle. Code that both apps use goes into `@micacms/runtime`, never into `@micacms/auth-oidc`.
- The self-hosted Mica (`apps/self-hosted`) is only the container image `ghcr.io/micacms/mica`, for `linux/amd64` and `linux/arm64`. It is not published to npm.
- Mica never stores or hashes a password. The identity provider signs people in.

## Consequences

- A local Mica is an open editor for each process on the developer's computer. Such a process can also change the working tree directly.
- To edit from another computer, use the self-hosted image.
- A Node host without Docker cannot run the self-hosted Mica.
- Change this decision when: there is a real need for a server without Docker. Then add a `bin` under semver.

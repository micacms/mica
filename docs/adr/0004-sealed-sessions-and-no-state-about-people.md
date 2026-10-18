# 4. A session is a sealed cookie, and the server keeps no state about people

**Status:** Accepted

## Context

Mica keeps no database ([1](0001-git-is-the-source-of-truth.md)). A session table would store who somebody is.

## Decision

- A self-hosted session is the `mica_session` cookie: AES-256-GCM over the identity, the CSRF token and the expiry, with a key from `MICA_SESSION_SECRET`. The cookie keeps only the groups that a rule names, because a cookie holds 4 kB.
- A form keeps its unsaved changes, with their revision, in the `sessionStorage` of the tab. After a new sign-in, the form offers them again. The server stores nothing.
- Rate limits are fixed-window counters in the process. They limit the start of a sign-in and the OAuth and MCP routes.

## Consequences

- The server cannot end one session. Sign-out clears the cookie, but a copy stays valid until it expires. A new `MICA_SESSION_SECRET` ends all sessions.
- The counters start again at each restart, and count for one process only. The design has one process for each site ([7](0007-self-hosted-mica-keeps-its-own-clone.md)).
- Revisit when: one session must end within seconds while the others continue (a deny list is server state again), or a site needs more than one process.

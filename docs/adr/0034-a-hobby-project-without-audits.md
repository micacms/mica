# 34. A hobby project: best effort, no outside audits before 1.0, docs on the website

**Status:** Accepted

## Context

Mica has one maintainer. A promise that one person cannot keep is worse than none. A paid audit does not fit a hobby project, and a volunteer review is not in the maintainer's control.

## Decision

- `GOVERNANCE.md` states that Mica is a hobby project of one maintainer, built largely with AI-assisted coding, and kept on a best-effort basis, without response times. 1.0 does not wait for a second maintainer.
- Nobody outside the project reviews the security before 1.0. CodeQL and a dependency audit run in CI, and the maintainer reviews the authentication, session, CSRF and admission code against OWASP ASVS level 1 (`docs/security-review.md`). `SECURITY.md` says that Mica has no independent audit.
- The editor aims at WCAG 2.2 AA. The browser test runs axe on each view, and a serious or critical finding fails CI. There is no audit before 1.0, and Mica claims no conformance.
- The user documentation is Mica content in `sites/micacms/content/docs`, published on micacms.com. `docs/` holds the contributor documents: the architecture, the content format and these records.

## Consequences

- An agency that needs a response time, an audit or continuity must plan for it, for example with the ability to fork.
- One account owns the organization, the npm scope, the domain and the release secrets.
- Change this decision when: a second person wants to maintain Mica, or somebody offers or funds an audit.

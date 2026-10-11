# Security policy

## Report a vulnerability

Do not open a public issue for a vulnerability.

Report it privately through GitHub: open the repository's **Security** tab and
select **Report a vulnerability**. Include the affected version, the mode (the
local editor or the self-hosted image), the steps to reproduce, and the effect.

## What to expect

Mica is a hobby project of one maintainer, maintained on a best-effort basis
(see [GOVERNANCE.md](GOVERNANCE.md) when it exists). There are no response
times. A valid report is fixed in the next release, as soon as the maintainer
can.

Mica is **not independently audited**. Its authentication, session, CSRF and
admission code is reviewed by the maintainer against the OWASP ASVS level 1
checklist ([docs/security-review.md](docs/security-review.md)), and CI runs a
dependency audit.

## Supported versions

Only the latest release gets fixes, security fixes included. Until 1.0, that
is the latest `0.x` release. When 1.0 ships, `0.x` gets no more fixes.

## Disclosure

A fixed vulnerability is published as a GitHub Security Advisory and in a
**Security** section of the release in [CHANGELOG.md](CHANGELOG.md). The
reporter is credited unless they ask not to be.

## Scope

The security model — what Mica protects, the trust boundaries, the accepted
risks and the hardening steps — is on the website:
<https://micacms.com/docs/security/>.

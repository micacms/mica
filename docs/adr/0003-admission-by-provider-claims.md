# 3. Admission is a rule over provider claims, not an account

**Status:** Accepted

## Context

A self-hosted Mica must know who can edit. A table of users and memberships is an identity product inside the CMS. The identity provider already manages people.

## Decision

- The configuration admits people: `MICA_ADMIT_GROUPS`, `MICA_ADMIT_DOMAINS`, `MICA_ADMIT_EMAILS` or `MICA_ADMIT_SUBJECTS` (pairs of issuer and subject). The image does not start when no rule is set.
- The domain and email rules need `email_verified` from the provider. Addresses are compared without case. A domain rule for a public provider, such as `gmail.com`, stops the start.
- `MICA_OIDC_GROUPS_CLAIM` names the group claim, because the claim has no standard name. It takes a Keycloak path or a plain name.
- Mica reads the rules at start, and checks them on each request against the claims that the provider sent at sign-in.

## Consequences

- To add an editor, change the provider or the configuration. Mica stays the same.
- A person that the provider removes from a group keeps access until the next sign-in: at most `MICA_SESSION_TTL_HOURS` (8 hours, or 4 hours without use). A changed rule, such as a subject removed from `MICA_ADMIT_SUBJECTS`, acts at the first request after a restart.
- An organisation that gives a former editor's address to a new person also gives this site. For such a domain, use a group or a subject rule.
- Change this decision when: a site must remove access within seconds, without a restart. Then ask the provider on each request, or keep a list that an operator can empty.

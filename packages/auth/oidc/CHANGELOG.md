# Change Log - @micacms/auth-oidc

This log was last generated on Tue, 13 Oct 2026 14:06:11 GMT and should not be manually modified.

## 0.7.0
Tue, 13 Oct 2026 14:06:11 GMT

### Minor changes

- Each admitted response names the end of the session in the x-mica-session-expires header, so that the editor can warn without extending an idle session

## 0.6.0
Tue, 13 Oct 2026 11:14:11 GMT

### Minor changes

- Breaking: `SESSION_SECRET`, `SESSION_TTL_HOURS` and `SESSION_IDLE_HOURS` are now `MICA_SESSION_*`; `LOGIN_MAX_ATTEMPTS` and `LOGIN_WINDOW_MS` are now `MICA_SIGNIN_MAX_ATTEMPTS` and `MICA_SIGNIN_WINDOW_MS`; `MICA_ADMIT_GROUP` and `MICA_ADMIT_DOMAIN` are now `MICA_ADMIT_GROUPS` and `MICA_ADMIT_DOMAINS`. The old names are not read.
- Breaking: requires Node 24 or newer.

### Updates

- The README states that the package is internal.

## 0.5.0
Tue, 13 Oct 2026 04:44:02 GMT

_Version update only_

## 0.4.0
Sun, 11 Oct 2026 15:57:57 GMT

### Patches

- Security: sign the transaction cookie with an HKDF-derived key, and take an email address and its email_verified flag from the same answer
- Security: a refused sign-in redirects with a code instead of a message, so the URL carries no email address

### Updates

- Security: with TRUST_PROXY, take the client address from the right-most X-Forwarded-For entry, and rate limit the sign-in callback
- Security: after sign-in, return only to a page of the editor on this origin; a return path such as /\evil.example no longer leaves the site
- Security: over https, prefix the session and CSRF cookies with __Host- and send Strict-Transport-Security; in production, refuse an http:// public URL except on loopback
- Require hono 4.13.7 and image-size 2.0.3, which fix published security advisories

## 0.3.0
Sat, 10 Oct 2026 18:31:39 GMT

### Minor changes

- Admit verified email addresses with MICA_ADMIT_EMAILS, for providers with no groups claim such as Google. A MICA_ADMIT_DOMAIN that names a public provider such as gmail.com now stops startup.
- Keep sessions in an encrypted cookie instead of SQLite. createOidcAuth no longer takes a database, and the session repository exports are removed. Everyone signs in once more after the upgrade.

## 0.2.2
Sat, 10 Oct 2026 15:31:13 GMT

_Version update only_

## 0.2.1
Sat, 10 Oct 2026 14:58:49 GMT

_Version update only_

## 0.2.0
Mon, 31 Aug 2026 06:07:50 GMT

### Minor changes

- A larger refactor. Saves now land in a draft workspace and an explicit Publish writes them to the repository as one commit — a working tree under the local connector, a draft store behind the provider connectors. The editor split into composable packages: an authentication-neutral runtime, the admin SPA as built assets, a server-only OIDC gate, and two composition roots — `@micacms/editor` (`npx`, loopback, no authentication code at all) and `@micacms/self-hosted` (Docker, behind OIDC). `MICA_MODE` is gone: the mode is which app you run. `@micacms/model` was renamed to `@micacms/core`.


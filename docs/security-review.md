# Security self-review: OWASP ASVS 5.0.0, level 1

This is the self-review that
[decision record 34](adr/0034-a-hobby-project-without-audits.md) asks for. It is not an
independent audit. Anybody can check it: every result names the code that it
is based on, by file and, where it helps, by function. Line numbers are left
out, because they go out of date with each change.

## Scope

- **Standard:** OWASP ASVS 5.0.0, level 1 requirements. V10 also has a table
  of level 2 requirements, because the sign-in and the agent access depend on
  them. The summary does not count that table.
- **Date:** 2026-10-18.
- **Reviewer:** the maintainer, with an AI reviewer.
- **Basis:** `main` at `95cd71c`, version 0.11.0.
- **Method:** reading the code. The package tests of `@micacms/auth-oidc` (49)
  and `@micacms/mcp` (19) ran and passed. `matchRedirectUri`,
  `checkRedirectUri` and the address check of the client document fetch ran
  once with hostile input. No scanner, no container and no live attack ran.
- **Code reviewed:**
  - `packages/auth/oidc/src/`: the sign-in, the session, the admission rules,
    the gate, and the OAuth 2.1 authorization server for `/mcp` (`oauth/`).
  - `packages/mcp/src/`: the tools, their scopes and the `/mcp` route.
  - `packages/runtime/src/`: the app, the middleware, the routes, the content,
    media and upload services, the rate limit, the logger, the file layer and
    the Git working tree.
  - `packages/core/src/`: the path helpers (`source.ts`, `node.ts`), the media
    type table (`media-types.ts`), the maps (`map.ts`), the validation and the
    manifest reader.
  - `packages/editor-ui/src/`, as it runs in the browser.
  - `apps/local-editor/src/` (its network surface) and `apps/self-hosted/src/`,
    with the Git LFS and credential path.
- **Not reviewed:** the identity provider, the website's own templates, and
  the MCP SDK (`@modelcontextprotocol/server`) beyond its scope check.

## Summary

| Status | Count |
| --- | --- |
| Pass | 55 |
| Partial | 0 |
| Fail | 0 |
| Accepted | 7: 7.4.1, 7.4.2, 10.4.1, 10.4.2, 10.4.5, 14.3.1, 15.1.1 |
| N/A | 9 (some rows group several requirements) |

Every finding of the earlier reviews is fixed. This review found five new
ones: one medium (N19), three low and one with no severity. The pull request of
this review (#310) fixes N19, N20, N22 and N23, and the loopback part of N21.
The level 2 table of V10 has two Accepted rows.

### Earlier findings, fixed

| # | Finding | Fixed in |
| --- | --- | --- |
| N1, N2, N4 | No HSTS; an `http://` public URL on another machine; cookies without a prefix | #157, #161, #233 |
| N3, N13 | An upload in memory before the size check | #158, #235 |
| N5, N9 | Left-most `X-Forwarded-For`; no limit on the OIDC callback | #159 |
| N6, N7, N10 | Email in the URL; unchecked `x-request-id`; text media without a charset | #160 |
| N8, #79 | `/health` showed details and called the provider | #156 |
| #85, N11, N12, N15 | Paths out of the content root: `../`, a symbolic link, a save ID, a media value | #153, #256 |
| #86, #88 | Media served without a sandbox, SVG accepted; no Content-Security-Policy | #154, #146 |
| #87 | `safeReturnTo` accepted `/\evil.example` | #155 |
| N14 | Unsaved form values stayed after sign-out | #256 |
| N16, N17, N18 | Inherited names as collections; greedy media prefix; custom Markdoc tags | #256 |

### New findings

| # | Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| N19 | medium | The consent page accepts a click on Allow at once. A page on another site can use a double click: it puts the consent page behind a pop-up window, and the second click of the double click lands on Allow (double-clickjacking). `frame-ancestors 'none'` does not stop this, because the page is a top-level window. The five-minute sign-in rule does not stop it either, because a provider with single sign-on signs the person in again without a question. The attacker registers a client with its own redirect URI and holds the PKCE verifier, so it gets the tokens of the person: read all content, change and discard drafts, and publish with `MICA_MCP_PUBLISH`. Only with `MICA_MCP=true`. | `packages/auth/oidc/src/oauth/pages.ts` (`consentPage`); `packages/auth/oidc/src/oauth/routes.ts` (`GET /oauth/authorize`) | Make Allow active only after a short time, without script: for example `pointer-events: none` with a CSS animation that ends after about one second. Or ask for a second, deliberate step. **Fixed:** Allow is inactive for one second (CSS), and the server refuses an Allow sooner than `CONSENT_DELAY_MS`. |
| N20 | low | The address check of the client document fetch misses some IPv6 ranges: `64:ff9b:1::/48` (local NAT64), `::/96` (IPv4-compatible), `fec0::/10`, `100::/64` and `2001:db8::/32`. On a network with a local NAT64 gateway, a document address can reach a private IPv4 service. Any port is allowed. Only an admitted person who signed in recently can cause a fetch. | `packages/auth/oidc/src/oauth/clients.ts` (`PRIVATE`, `isPublicAddress`) | Add the ranges. Consider port 443 only. **Fixed:** the ranges are in `PRIVATE`. Any port stays allowed. |
| N21 | none | For a loopback redirect URI on another port, `matchRedirectUri` compares the host name, the path and the query only. A fragment or a user name in the requested URI is accepted and kept. Any private-use scheme, such as `ms-msdt:`, can be registered. | `packages/auth/oidc/src/oauth/clients.ts` (`matchRedirectUri`, `checkRedirectUri`) | Refuse a fragment and a user name on the loopback path. Accept only a reverse-domain scheme (RFC 8252, section 7.1). **Fixed in part:** the loopback path refuses a fragment and a user name. Any private-use scheme stays allowed, because MCP clients use schemes such as `cursor://`. |
| N22 | low | An MCP tool that fails because the disk is full or read-only answers the agent, but does not write the error to Mica's log. The admin API logs it. The operator does not see the cause. | `packages/mcp/src/server.ts` (`failure`); `packages/runtime/src/middleware/index.ts` (`errorHandler`, `storageError`) | Log `storage_unavailable` as an error in `failure` too. **Fixed:** `failure` logs `storage_unavailable` as an error. |
| N23 | low | The `hd` check applies only when the issuer is Google. A broker that signs people in with Google, such as Dex, Keycloak or ZITADEL, sends its own issuer and Google's `email_verified`. A domain rule then admits a personal Google account with a company address. The docs say nothing about this case. | `packages/auth/oidc/src/admission.ts` (`hostedDomainAgrees`); `sites/micacms/content/docs/other-providers/body.mdoc` | Say on the security and provider pages: with Google behind a broker, limit the broker to the Workspace domain (for Dex, `hostedDomains`), or use a group or subject rule. **Fixed in the docs:** the security and provider pages say it. |

## V1 Encoding and Sanitization

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 1.2.1 | Output encoding for HTML and HTTP | Pass | `packages/editor-ui/src/views/LoginView.vue`; `packages/auth/oidc/src/oauth/pages.ts` (`escape`) | Vue text interpolation; no `v-html` or `innerHTML` in `packages/editor-ui/src`. The consent and error pages escape every value. |
| 1.2.2 | URLs built with encoded data | Pass | `packages/auth/oidc/src/routes.ts`; `packages/auth/oidc/src/oauth/routes.ts` (`back`); `packages/editor-ui/src/api.ts`; `packages/editor-ui/src/lib/rich-text-extensions.ts` | The authorization response is built with `URLSearchParams`. A redirect URI cannot use `javascript:`, `data:`, `file:` or `blob:`. Rich-text links allow `http`, `https`, `mailto` and `tel` only. |
| 1.2.3 | Safe JSON output | Pass | `packages/runtime/src/middleware/index.ts` (`errorHandler`); `packages/mcp/src/server.ts` (`ok`) | `c.json` and `JSON.stringify` only. |
| 1.2.4 | Parameterized database queries | N/A | — | Mica has no database. |
| 1.2.5 | No OS command injection | Pass | `packages/runtime/src/workspace/git.ts`; `packages/runtime/src/workspace/tree.ts`; `packages/runtime/src/workspace/lfs.ts`; `apps/self-hosted/src/config.ts` (`isBranchName`); `apps/self-hosted/src/workspace/isolation.ts` (`HELPER`) | `execFile` with an argument array, `--` before paths, literal pathspecs and a checked branch name. The credential helper is a fixed text; it reads its values from the environment. |
| 1.3.1 | WYSIWYG HTML sanitized | N/A | `packages/astro/src/richtext.ts` | Mica stores Markdoc, not HTML. Markdoc renders raw HTML as text and refuses `javascript:` and `data:` links. |
| 1.3.2 | No `eval` or dynamic code | Pass | repository-wide search; `packages/runtime/src/middleware/index.ts` (`contentSecurityPolicy`) | No `eval` or `new Function` in the shipped code, and no `'unsafe-eval'` in the policy. |
| 1.5.1 | Safe XML parser | N/A | `packages/runtime/src/lib/file-type.ts` (`textType`, `isSvg`) | No XML parser. GPX and KML are found by a text prefix, and SVG is refused. |

## V2 Validation and Business Logic

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 2.1.1 | Validation rules documented | Pass | `sites/micacms/content/docs/reference-fields/body.mdoc`; `docs/adr/0018-media-files.md`; `sites/micacms/content/docs/configuration/body.mdoc` | The field rules, the media types, `MICA_MAX_UPLOAD_BYTES` and the request limits (2 MB for JSON, 64 kB for `/oauth/*`, the upload limit for `/mcp`) are documented. |
| 2.2.1 | Positive input validation | Pass | `packages/runtime/src/services/content-store.ts` (`existingId`, `requireCollection`); `packages/mcp/src/server.ts`; `packages/auth/oidc/src/oauth/routes.ts` | Every ID of an existing entry is one segment. The tools have Zod inputs. The authorization server checks `response_type`, PKCE, `resource` and the redirect URI. |
| 2.2.2 | Validation on the server | Pass | `packages/runtime/src/services/content-store.ts` (`validate`); `packages/auth/oidc/src/config.ts` | The editor and an agent use the same services. |
| 2.3.1 | Business flow in the expected order | Pass | `packages/runtime/src/services/staging.ts`; `packages/mcp/src/server.ts`; `packages/auth/oidc/src/oauth/tokens.ts` (`open`) | A write carries the revision that the editor or the agent read. Each sealed token has a kind, so a consent request, a code, an access token and a refresh token cannot replace each other. |

## V3 Web Frontend Security

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 3.2.1 | Content cannot render in the wrong context | Pass | `packages/runtime/src/routes/admin-media.ts`; `packages/runtime/src/services/media.ts` (`typeOf`) | Every file gets `sandbox; default-src 'none'`, a file that is not an image is a download, and SVG is refused by its bytes or by its name. |
| 3.2.2 | Text rendered as text | Pass | `packages/editor-ui/src/views/LoginView.vue` | `?error=` is a code that maps to fixed text. |
| 3.3.1 | Cookies `Secure`, with a prefix | Pass | `packages/auth/oidc/src/session.ts` (`cookieNames`); `apps/self-hosted/src/config.ts` | `__Host-` (`__Secure-` for the transaction cookie) over https; `http://` only on this machine. |
| 3.4.1 | HSTS on all responses | Pass | `packages/runtime/src/middleware/index.ts` (`securityHeaders`) | `max-age=31536000` when the public URL is `https://`, also on `/oauth/*` and `/mcp`. |
| 3.4.2 | CORS origin fixed or allowlisted | Pass | `packages/runtime/src/app.ts`; `packages/auth/oidc/src/oauth/routes.ts` | An allowlist, with credentials, for `/api`. `*` without credentials for the metadata documents, `/oauth/token` and `/oauth/register`, which read no cookie. |
| 3.4.3 | Content-Security-Policy | Pass | `packages/runtime/src/middleware/index.ts` (`contentSecurityPolicy`); `packages/core/src/map.ts`; `packages/auth/oidc/src/oauth/pages.ts` (`page`) | `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`. The hosts of a map only when the model has one. The consent page has `default-src 'none'` and a style nonce. ID approximate. |
| 3.5.1 | CSRF: origin check or token | Pass | `packages/runtime/src/middleware/index.ts` (`originGuard`); `packages/auth/oidc/src/gate.ts` (`csrfProtection`); `packages/auth/oidc/src/oauth/routes.ts` (`POST /oauth/authorize`) | Origin check and a double-submit token bound to the session. The consent form needs the session's CSRF token and refuses another `Origin`. Sign-out has the origin check only. |
| 3.5.2 | No reliance on a CORS preflight | N/A | — | The preflight is not a control; see 3.5.1. |
| 3.5.3 | No state change on GET | Pass | `packages/runtime/src/routes/`; `packages/auth/oidc/src/routes.ts`; `packages/auth/oidc/src/oauth/routes.ts` | `GET /oauth/authorize` only shows the consent page. |
| 3.7.x | Redirects only to allowed targets | Pass | `packages/auth/oidc/src/return-to.ts` (`safeReturnTo`); `packages/auth/oidc/src/oauth/routes.ts` | After sign-in: the public URL's origin, an `/admin` path or `/oauth/authorize`. Each error before the consent stays on Mica's page, so a registered URI gets no automatic redirect. ID and level approximate. |

`nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` and a `Permissions-Policy`
are set (`packages/runtime/src/middleware/index.ts`). They are level 2, so they
are not counted.

A `coordinates({ map })` field makes the editor's browser load a style, tiles,
glyphs and sprites from the hosts that the model names
([decision record 21](adr/0021-field-rules.md)). Each host must be an `https`
origin without a path (`mapProblem`), and `readManifest` checks it through
`defineSite`. So a pushed model cannot add a directive to the policy. The tile
host sees the editor's IP address and the area of the map.

## V4 API and Web Service

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 4.1.1 | Correct Content-Type with charset | Pass | `packages/runtime/src/routes/admin-media.ts`; `packages/runtime/src/routes/admin-spa.ts` | Text media get `; charset=utf-8`. |
| 4.3.x, 4.4.1 | GraphQL; WebSocket over TLS | N/A | `packages/mcp/src/http.ts` | Mica has neither. `/mcp` is Streamable HTTP on the same server. |

## V5 File Handling

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 5.2.1 | Size limit without DoS | Pass | `packages/runtime/src/middleware/index.ts` (`requestSizeLimit`); `packages/runtime/src/services/media.ts` (`receive`); `packages/mcp/src/http.ts` | JSON over 2 MB is refused. An editor's upload streams to disk and stops at `MICA_MAX_UPLOAD_BYTES`. An agent's upload is base64 in memory, up to a third more than the limit plus 1 MB, behind the bearer gate ([decision record 28](adr/0028-agents-edit-through-mcp.md)). |
| 5.2.2 | Type from content; extension matches | Pass | `packages/core/src/media-types.ts`; `packages/runtime/src/lib/file-type.ts` (`detectFileType`); `packages/runtime/src/services/media.ts` (`safeName`) | One table: images, PDF, GPX, KML, GeoJSON, ZIP and CSV. The type comes from the bytes; the name decides only for ZIP and CSV. The extension comes from the detected type. |
| 5.3.1 | Uploads never run as server code | Pass | `packages/runtime/src/routes/admin-media.ts` | Uploads are files in the content. Nothing parses or runs them. |
| 5.3.2 | Paths from user input confined | Pass | `packages/core/src/source.ts` (`contentPath`); `packages/core/src/node.ts` (`within`); `packages/runtime/src/workspace/files.ts` (`full`); `packages/runtime/src/services/media.ts` (`uploadDirectory`); `packages/core/src/validation.ts` | `.`, `..`, `.git`, `\`, control characters and drive letters are refused. The real location must stay in the real content root. A write renames beside the target, so it never writes through a link. Uploads go only into a `media` folder, also from an agent. |

## V6 Authentication

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 6.1.1 | Rate limiting documented | Pass | `docs/adr/0004-sealed-sessions-and-no-state-about-people.md`; `packages/auth/oidc/src/config.ts` | |
| 6.3.1 | Brute-force controls | Pass | `packages/auth/oidc/src/routes.ts`; `packages/runtime/src/middleware/index.ts` (`rateLimit`) | The provider checks credentials. Mica limits sign-in starts and callbacks for each address, and `/api`, `/oauth/*` and `/mcp` share a limit of 600 requests a minute for each address. Sealed tokens cannot be guessed. |
| 6.3.2 | No default accounts | Pass | `packages/auth/oidc/src/config.ts` (`requireAuthConfig`) | No accounts; the image refuses to start without an admission rule. |
| 6.2.x, 6.4.x | Passwords, recovery | N/A | `packages/auth/oidc/src/oidc.ts` | The identity provider does these. |

## V7 Session Management

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 7.2.1 | Session checked on the server | Pass | `packages/auth/oidc/src/gate.ts` (`requireAccess`); `packages/auth/oidc/src/oauth/gate.ts` (`agentGate`) | A cookie for `/api/admin`, a bearer token for `/mcp`. A token does not open `/api/admin`, and a cookie does not open `/mcp`. |
| 7.2.2 | Dynamic tokens, not static keys | Pass | `packages/auth/oidc/src/session.ts`; `packages/auth/oidc/src/oauth/tokens.ts` | |
| 7.2.3 | Reference token entropy ≥ 128 bits | N/A | `packages/auth/oidc/src/session.ts`; `packages/auth/oidc/src/oauth/tokens.ts` | Sessions and agent tokens are self-contained (V9). The CSRF token has 256 bits. |
| 7.2.4 | New token at authentication | Pass | `packages/auth/oidc/src/routes.ts`; `packages/auth/oidc/src/session.ts` (`create`) | |
| 7.4.1 | Session unusable after logout | Accepted | `packages/auth/oidc/src/routes.ts` (`/logout`); `docs/adr/0004-sealed-sessions-and-no-state-about-people.md`; `docs/adr/0029-mica-is-the-authorization-server-for-mcp.md` | A copied cookie stays valid until it expires. Sign-out does not end an agent's grant. A new `MICA_SESSION_SECRET` ends all. |
| 7.4.2 | Sessions end when access is removed | Accepted | `packages/auth/oidc/src/gate.ts`; `packages/auth/oidc/src/oauth/gate.ts`; `docs/adr/0003-admission-by-provider-claims.md` | A rule change acts at the first request after a restart, for sessions and agents. A change at the provider waits for the next sign-in: at most 8 hours by default. |

The idle and absolute timeouts are implemented
(`packages/auth/oidc/src/session.ts`). They are level 2.

## V8 Authorization

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 8.1.1 | Authorization rules documented | Pass | `packages/auth/oidc/src/admission.ts`; `sites/micacms/content/docs/self-hosting/body.mdoc`; `docs/adr/0029-mica-is-the-authorization-server-for-mcp.md` | The scopes are on the consent page in words (`SCOPE_WORDS`). |
| 8.2.1 | Function-level access control | Pass | `packages/runtime/src/app.ts`; `packages/auth/oidc/src/gate.ts`; `packages/mcp/src/server.ts` (`needs`) | Each tool names its scope, and the MCP SDK refuses a call without it (`insufficient_scope`). `publish` exists only with `MICA_MCP_PUBLISH` and needs `content:publish`. |
| 8.2.2 | Data-level access (IDOR) | Pass | `packages/runtime/src/app.ts` | One site and one role, by design. |
| 8.3.1 | Enforced on the server | Pass | `packages/auth/oidc/src/gate.ts`; `packages/auth/oidc/src/oauth/gate.ts` | Admission is checked on every request, also for an agent. |

## V9 Self-contained Tokens

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 9.1.1 | Signature or MAC checked before use | Pass | `packages/auth/oidc/src/sealed.ts` (`unseal`); `packages/auth/oidc/src/oidc.ts` | GCM tag for the session, the agent tokens and a registered client ID; HMAC for the transaction cookie; `openid-client` for the ID token. |
| 9.1.2 | Algorithm allowlist, no `none` | Pass | `packages/auth/oidc/src/sealed.ts`; `packages/auth/oidc/src/oidc.ts` | One fixed algorithm. ID approximate. |
| 9.1.3 | Keys from trusted sources | Pass | `packages/auth/oidc/src/sealed.ts` (`sealingKey`); `apps/self-hosted/src/config.ts` | `MICA_SESSION_SECRET` is required. HKDF gives one key for each purpose: session, transaction, agent tokens and agent clients. JWKS from discovery. |
| 9.2.1 | Validity period enforced | Pass | `packages/auth/oidc/src/session.ts` (`resolve`); `packages/auth/oidc/src/oauth/tokens.ts` (`open`) | Each sealed value has its expiry inside. |

## V10 OAuth and OIDC

Mica is an OIDC relying party for the sign-in, and the OAuth 2.1
authorization server and resource server of `/mcp`
([decision record 29](adr/0029-mica-is-the-authorization-server-for-mcp.md)).

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 10.4.1 | Redirect URI by exact match | Accepted | `packages/auth/oidc/src/oauth/clients.ts` (`matchRedirectUri`); `docs/adr/0029-mica-is-the-authorization-server-for-mcp.md` | Exact string match, except that a loopback URI matches on any port (RFC 8252). See N21. |
| 10.4.2 | Code used once; reuse revokes tokens | Accepted | `packages/auth/oidc/src/oauth/tokens.ts` (`createUsedCodes`); `docs/adr/0029-mica-is-the-authorization-server-for-mcp.md` | Single use in the memory of the process. Mica cannot revoke the tokens of a reused code. After a restart, the 60-second life and PKCE remain. |
| 10.4.3 | Code is short-lived | Pass | `packages/auth/oidc/src/oauth/tokens.ts` (`LIFETIME_MS`) | 60 seconds. |
| 10.4.4 | Only the grants that a client needs | Pass | `packages/auth/oidc/src/oauth/routes.ts` (`/oauth/token`) | `authorization_code` and `refresh_token` only. No implicit, password or client credentials grant. |
| 10.4.5 | Refresh token replay mitigated | Accepted | `packages/auth/oidc/src/oauth/routes.ts` (`issueFor`); `docs/adr/0029-mica-is-the-authorization-server-for-mcp.md` | No rotation and no sender constraint. A copied refresh token works until the grant ends, at most `MICA_SESSION_TTL_HOURS`. Admission is checked at each refresh. |

### Level 2 requirements for the sign-in and the agent access

Not counted in the summary. The levels and some IDs are approximate.

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 10.1.1 | Tokens only where needed | Pass | `packages/auth/oidc/src/oidc.ts` | The provider's access token is used once, for userinfo, and not stored. |
| 10.2.1 | Client: code flow with PKCE and state | Pass | `packages/auth/oidc/src/oidc.ts` | S256; the redirect URI is fixed. |
| 10.3.1 | Resource server checks the audience | Pass | `packages/auth/oidc/src/oauth/gate.ts`; `packages/auth/oidc/src/oauth/routes.ts` (`sameResource`) | Each token carries the `/mcp` address (RFC 8707). |
| 10.3.2 | Resource server enforces scopes | Pass | `packages/mcp/src/server.ts` (`needs`); `packages/mcp/test/mcp.test.ts` | See 8.2.1. |
| 10.4.6 | PKCE required, no `plain` | Pass | `packages/auth/oidc/src/oauth/routes.ts` (`PKCE`) | S256 only; the verifier is compared in constant time. |
| 10.4.7 | Dynamic registration risk mitigated | Pass | `packages/auth/oidc/src/oauth/clients.ts` (`register`); `packages/auth/oidc/src/oauth/pages.ts` | The redirect URIs are checked. The consent page says that a registered app's name is not confirmed, and shows where the code goes. |
| 10.4.8 | Refresh token has an absolute end | Pass | `packages/auth/oidc/src/oauth/tokens.ts` (`issue`) | The grant ends when the sign-in would end. |
| 10.4.9 | A person can revoke a grant | Accepted | `docs/adr/0029-mica-is-the-authorization-server-for-mcp.md` | No list of grants. A new `MICA_SESSION_SECRET` ends all. |
| 10.4.11 | Only the required scopes | Pass | `packages/auth/oidc/src/oauth/scopes.ts` (`grantedScopes`, `offeredScopes`) | `content:publish` only with `MICA_MCP_PUBLISH`. A refresh cannot add a scope. |
| 10.5.1 | Nonce checked | Pass | `packages/auth/oidc/src/oidc.ts` | |
| 10.5.2 | User identified by issuer and subject | Pass | `packages/auth/oidc/src/admission.ts` | Email rules need `email_verified`. With Google as the issuer, a domain rule also needs an admitted `hd`. See N23. |
| 10.5.3 | ID token issuer, audience and expiry checked | Pass | `packages/auth/oidc/src/oidc.ts` | By `openid-client`. |
| 10.7.1 | Consent for each authorization | Pass | `packages/auth/oidc/src/oauth/routes.ts`; `packages/auth/oidc/src/oauth/pages.ts` | Each request shows the page, and Mica remembers no consent. The page needs an admitted person who signed in in the last five minutes, and Allow works only after one second (N19). |
| 10.7.2 | Consent page gives clear information | Pass | `packages/auth/oidc/src/oauth/pages.ts` (`consentPage`) | The app, whether its name is confirmed, the person, the permissions, where the code goes and when the access ends. |
| 10.7.3 | A person can review and revoke consents | Accepted | `docs/adr/0029-mica-is-the-authorization-server-for-mcp.md` | See 10.4.9. |

## V11 Cryptography

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 11.3.1 | No ECB or weak padding | Pass | `packages/auth/oidc/src/sealed.ts` | |
| 11.3.2 | Approved authenticated cipher | Pass | `packages/auth/oidc/src/sealed.ts` | AES-256-GCM, random 96-bit IV, a key from HKDF for each purpose. |
| 11.4.1 | Approved hash functions | Pass | `packages/auth/oidc/src/oidc.ts`; `packages/auth/oidc/src/oauth/routes.ts`; `packages/runtime/src/workspace/files.ts` | SHA-256 only. |
| 11.5.1 | CSPRNG for secrets | Pass | `packages/runtime/src/lib/id.ts`; `packages/auth/oidc/src/oauth/tokens.ts`; `packages/auth/oidc/src/oidc.ts` | `randomBytes` and `openid-client`. ID approximate. |

## V12 Secure Communication

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 12.1.1 | Current TLS versions only | N/A | `sites/micacms/content/docs/self-hosting/body.mdoc` | The operator's proxy terminates TLS. |
| 12.2.1 | TLS for all connections | Pass | `apps/self-hosted/src/config.ts`; `apps/self-hosted/src/workspace/credentials.ts` (`parseRemote`); `packages/auth/oidc/src/config.ts`; `packages/auth/oidc/src/oauth/clients.ts` (`fetchJson`) | The public URL, the issuer, the repository and the LFS URL need `https://`, except on this machine. A client document is fetched over https only, with certificate checks. |
| 12.2.2 | Publicly trusted certificates | N/A | — | The proxy holds the certificate. |

## V13 Configuration

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 13.4.1 | No source-control metadata exposed | Pass | `packages/runtime/src/routes/admin-spa.ts`; `packages/core/src/source.ts` (`contentPath`) | Only the editor's build is served, and no content path can name `.git`. |
| 13.4.2 | Debug mode off in production | Pass | `Dockerfile` | Mica has no debug mode. The image sets `NODE_ENV=production` for its libraries. The app code belongs to root, and Mica runs as `node`. ID approximate. |
| 13.4.x | No needless information on anonymous endpoints | Pass | `packages/runtime/src/routes/health.ts`; `apps/self-hosted/src/readiness.ts`; `packages/auth/oidc/src/oauth/routes.ts` | `/health` sends only `status`; `/ready` sends reason codes and the time of the last sync. The OAuth metadata names only the endpoints and the scopes. ID approximate. |
| 13.x | Anonymous endpoint uses provider quota | Pass | `packages/runtime/src/routes/health.ts`; `packages/auth/oidc/src/oauth/routes.ts` (`GET /oauth/authorize`) | `/health` does no I/O. Mica fetches a client document only for an admitted person with a recent sign-in. ID approximate. |

## V14 Data Protection

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 14.2.1 | Sensitive data not in the URL | Pass | `packages/auth/oidc/src/routes.ts`; `packages/auth/oidc/src/oauth/gate.ts` | A refused sign-in redirects with an error code. Sessions are in cookies, agent tokens in the `Authorization` header and in POST bodies. The code is in the redirect, as OAuth requires, and lives 60 seconds. |
| 14.3.1 | Client data cleared at logout | Accepted | `packages/editor-ui/src/stores/session.ts` (`forgetKeptChanges`); `docs/adr/0004-sealed-sessions-and-no-state-about-people.md` | Sign-out clears the cookies and the unsaved form values. When a session expires, the form values stay in the tab, so that the form can offer them after the next sign-in. Media are cached `private, no-cache`. |

## V15 Secure Coding and Architecture

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 15.1.1 | Remediation time frames documented | Accepted | `SECURITY.md`; `docs/adr/0034-a-hobby-project-without-audits.md`; `docs/adr/0031-support-policy.md` | No time frames: a fix comes in the next release, as soon as the maintainer can. |
| 15.2.1 | Components within the time frames | Pass | `scripts/audit.mjs`; `.github/workflows/ci.yml`; `.github/workflows/dependencies.yml` | A high or critical advisory in what Mica ships fails CI. A weekly audit opens an issue. |
| 15.3.1 | Only the required fields returned | Pass | `packages/auth/oidc/src/routes.ts` (`/me`); `packages/runtime/src/routes/responses.ts`; `packages/mcp/src/server.ts` | No secret, token or claim set goes to the editor or an agent. |

## V16 Security Logging and Error Handling

The IDs and levels in this chapter are approximate.

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 16.3.1 | Authentication events logged | Pass | `packages/auth/oidc/src/routes.ts`; `packages/auth/oidc/src/gate.ts`; `packages/auth/oidc/src/oauth/routes.ts`; `packages/auth/oidc/src/oauth/gate.ts` | Sign-in, refusal, an allowed agent, a refused client and an agent of a person no longer admitted. |
| 16.3.x | Failures that an operator must act on are logged | Pass | `packages/runtime/src/middleware/index.ts` (`errorHandler`); `packages/mcp/src/server.ts` (`failure`) | A full or read-only disk is logged for the admin API and for a tool (N22). |
| 16.4.1 | Log injection prevented | Pass | `packages/runtime/src/lib/logger.ts`; `packages/runtime/src/middleware/index.ts` (`requestContext`) | JSON lines escape values; a request ID must match `^[A-Za-z0-9_-]{1,64}$`; a client ID is cut to 200 characters. |
| 16.5.1 | Generic error to the client | Pass | `packages/runtime/src/middleware/index.ts` (`errorHandler`); `packages/mcp/src/server.ts` (`failure`) | A bug gives a generic message with the request ID; the stack stays in the log. A storage failure gives a message that a person can act on, without the path or the cause. |

## Agent access

An agent edits through the same services as the editor
([decision record 28](adr/0028-agents-edit-through-mcp.md)). These rows are
threats, not ASVS requirements, so the counts in the summary do not include
them.

| Threat | Status | Evidence | Note |
| --- | --- | --- | --- |
| Text in the content directs an agent (prompt injection) | Accepted | `packages/mcp/src/server.ts`; `docs/adr/0028-agents-edit-through-mcp.md` | By default an agent saves drafts only. `publish` needs `MICA_MCP_PUBLISH` and the `content:publish` scope. |
| A web page reaches the local `/mcp` | Pass | `apps/local-editor/src/guards.ts` (`hostGuard`); `packages/mcp/src/http.ts` (`originCheck`) | Loopback only, a Host allowlist against DNS rebinding, and a request with another `Origin` is refused. |
| An agent reads a file on the server | Pass | `apps/self-hosted/src/agents.ts`; `packages/mcp/src/server.ts` (`uploadBody`) | `upload_media` reads a local file only in the local editor and `mica mcp`. In the image, `localFiles` is false. |
| An agent writes over a newer save, or into a part that this build cannot write | Pass | `packages/mcp/src/server.ts` (`runWrite`); `packages/runtime/src/services/model-guard.ts`; `packages/runtime/src/services/content-store.ts` (`writable`) | Each write sends a revision. Writes stop while a newer model cannot be read. |
| A token for another resource, or a session cookie, opens `/mcp` | Pass | `packages/auth/oidc/src/oauth/gate.ts` | Only a bearer access token for this `/mcp` address. |
| A registered app pretends to be another app | Pass | `packages/auth/oidc/src/oauth/pages.ts` | The page says that the name is not confirmed, and shows where the code goes. See N19. |
| The client document fetch reaches Mica's own network (SSRF) | Pass | `packages/auth/oidc/src/oauth/clients.ts` (`fetchJson`, `publicLookup`) | https only, no redirect, 64 kB, 5 seconds, cached 5 minutes. Each address of a name is checked at connect time, so a rebound name cannot pass. Gaps: N20. |
| A stolen agent token | Accepted | `docs/adr/0029-mica-is-the-authorization-server-for-mcp.md` | An access token lives one hour, a grant at most `MICA_SESSION_TTL_HOURS`. Admission is checked on each request and refresh. |

## Git workspace

The self-hosted Mica runs `git` and Git LFS on a repository that someone else
controls, with a token. These rows are threats, not ASVS requirements, so the
counts in the summary do not include them.

| Threat | Status | Evidence | Note |
| --- | --- | --- | --- |
| Repository-controlled Git behaviour: hooks, filters, `.gitattributes`, symlinks, other protocols, submodules | Pass | `apps/self-hosted/src/workspace/isolation.ts` (`managedEnvironment`, `writeIsolationAttributes`); `apps/self-hosted/src/workspace/clone.ts` | No system or global configuration. Hooks off, `core.symlinks=false`, `info/attributes` turns off conversion and `ident`, only HTTPS (`http` only on this machine), and no submodules. The only filter driver is Git LFS's, from the environment. |
| `.lfsconfig` sends the files or the token to another server | Pass | `apps/self-hosted/src/workspace/isolation.ts`; `apps/self-hosted/src/workspace/lfs.ts` (`limitLfsToRoot`) | Git LFS reads only a short list of keys from `.lfsconfig`, and Git configuration wins over it. `lfs.url`, `lfs.pushurl` and `lfs.allowincompletepush` come from the environment. |
| Credential leak to another host, to a file, to a log or to the editor | Pass | `apps/self-hosted/src/workspace/credentials.ts` (`parseRemote`, `redact`); `apps/self-hosted/src/workspace/isolation.ts` (`HELPER`) | The token is not in a URL or in `.git/config`. A helper for the Git host, and for the host of `MICA_REPOSITORY_LFS_URL` when the operator sets one, answers `get` only. Git and Git LFS ask the helpers by host, so a redirect or an LFS action on another host gets nothing. The environment of `git` is an allowlist. `redact` removes the token from logs and messages. |
| Disk use: a clone that grows without limit | Partial | `apps/self-hosted/src/workspace/managed.ts` (`sizeOf`); `apps/self-hosted/src/compact.ts` | The System page shows the size, the LFS store included; there is no quota. Git LFS downloads only the files under the content root. `compact` removes old versions. |
| Path or option injection through the branch or the content root | Pass | `apps/self-hosted/src/config.ts` (`isBranchName`, the root check); `packages/runtime/src/workspace/tree.ts` (`inRepo`) | |
| A second process writes to the volume | Pass | `apps/self-hosted/src/workspace/lease.ts` | A lease with a heartbeat: a second Mica waits for it to expire, then refuses to start. |
| A rich-text image or a media value leaves the content root | Pass | `packages/core/src/rich-text.ts` (`resolveMarkdocTarget`); `packages/core/src/validation.ts`; `packages/astro/src/images.ts` | A path above the root resolves to nothing or fails validation. |
| A pushed content model widens the editor's Content-Security-Policy | Pass | `packages/core/src/map.ts` (`mapProblem`, `mapHosts`); `packages/runtime/src/middleware/index.ts` | Only through `coordinates({ map })`, and only with `https` origins. A person who can push the model can already change the content. |
| A pushed content model runs code | Pass | `packages/core/src/manifest.ts` (`readManifest`) | The manifest is data. A text pattern that repeats a group with a repeat inside, such as `(a+)+`, is refused when the model loads. Overlapping alternatives, such as `(a|a)+`, are still possible. |

## Next review

Review again before 1.0, after the new findings are fixed or accepted, and
when the authentication, session, OAuth, upload or Git code changes in a way
that these tables do not cover.

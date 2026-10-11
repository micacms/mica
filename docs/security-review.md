# Security self-review: OWASP ASVS 5.0.0, level 1

This is the self-review that the decision "No independent security review
before 1.0" asks for ([`decisions.md`](decisions.md)). It is not an
independent audit. Anybody can check it: every result names the code that it
is based on.

## Scope

- **Standard:** OWASP ASVS 5.0.0, level 1 requirements only.
- **Date:** 2026-10-11.
- **Reviewer:** the maintainer, with an AI reviewer.
- **Basis:** `main` at `c870834`.
- **Method:** reading the code. No tests, scanners or live attacks were run.
  The new findings were checked against the code a second time.
- **Code reviewed:**
  - `packages/auth/oidc/src/`: `admission.ts`, `config.ts`, `gate.ts`,
    `index.ts`, `oidc.ts`, `routes.ts`, `session.ts`.
  - `packages/runtime/src/`: `app.ts`, `http.ts`, `middleware/index.ts`,
    `lib/rate-limit.ts`, `lib/logger.ts`, `lib/file-type.ts`,
    `routes/admin-media.ts`, `routes/admin-spa.ts`, `routes/health.ts`,
    `services/media.ts`.
  - `apps/local-editor/src/` (`guards.ts`, `config.ts`, `index.ts`) and
    `apps/self-hosted/src/` (`config.ts`, `index.ts`).
  - The content path helpers in `packages/connectors/src/` and
    `packages/core/src/node.ts`.
- **Not reviewed:** how the website build renders content (`@micacms/astro`),
  and the identity provider.
- **Requirement IDs:** an ID marked "ID approximate" is the closest match in
  5.0.0.

## Summary

| Status | Count |
| --- | --- |
| Pass | 43 |
| Fail | 7: 5 tracked (#79, #85, #86, #87, #88), 1 accepted trade-off, 1 new (N1) |
| Partial | 9 |
| N/A | 9 (some rows group several requirements) |

### New findings

| # | Severity | Finding | Evidence | Fix | Issue |
| --- | --- | --- | --- | --- | --- |
| N1 | medium | No `Strict-Transport-Security` header, and the proxy example does not add one. | `packages/runtime/src/middleware/index.ts:58-68`; `docs/self-hosting.md:227-234` | Send HSTS when `MICA_PUBLIC_URL` is `https://`. | #147 |
| N2 | medium | Production starts with an `http://` public URL, and the cookies are then sent without `Secure`. | `packages/auth/oidc/src/config.ts:96`; `apps/self-hosted/src/config.ts:74-105` | Refuse a non-`https://` public URL in production, unless it is loopback. | #147 |
| N3 | low | An upload is read fully into memory before its size is checked. No route has a body limit. Only an admitted editor can reach it. | `packages/runtime/src/routes/admin-media.ts:32`; `packages/runtime/src/services/media.ts:87` | Hono `bodyLimit` on uploads and on JSON routes. | #148 |
| N4 | low | Cookie names have no `__Host-` or `__Secure-` prefix. | `packages/auth/oidc/src/session.ts:30-31`; `packages/auth/oidc/src/oidc.ts:37` | Prefix the names when the cookies are `Secure`. | #147 |
| N5 | low | With `TRUST_PROXY=true`, the client IP is the left-most `X-Forwarded-For` entry. Behind a proxy that appends to the header, a client can avoid the rate limits. | `packages/runtime/src/http.ts:34-38` | Use the right-most entry. | #149 |
| N6 | low | A refused sign-in puts the email address in the URL query, and so in browser history and proxy logs. | `packages/auth/oidc/src/routes.ts:119-120,154-157` | Redirect with an error code. | #150 |
| N7 | low | `x-request-id` comes from the client with no check, and is logged and sent back. | `packages/runtime/src/middleware/index.ts:23,29` | Accept only `^[A-Za-z0-9_-]{1,64}$`. | #150 |
| N8 | low | Anonymous `/health` shows the repository identity and the uptime. | `packages/runtime/src/routes/health.ts:42-47` | Send only `status` to anonymous callers. | #79 |
| N9 | low | The OIDC callback is not rate limited, although a comment says it is. A transaction cookie can be replayed for 15 minutes. | `packages/auth/oidc/src/routes.ts:82-84,116-133`; `packages/auth/oidc/src/oidc.ts:45` | Check `loginLimiter` in `/callback`. | #149 |
| N10 | low | `text/plain` and `text/csv` media are sent without a `charset`. | `packages/runtime/src/services/media.ts:198-199`; `packages/runtime/src/routes/admin-media.ts:91` | Add `; charset=utf-8`. | #150 |

The header of `lib/rate-limit.ts` said that sign-in is "protected by scrypt's
cost". Mica has no passwords. The comment is corrected together with this
review.

### Tracked issues, checked

- **#85, confirmed.** The local connector keeps paths inside the content root
  (`packages/core/src/node.ts:65-76`). The GitHub and GitLab connectors remove
  only leading and trailing slashes (`packages/connectors/src/github.ts:97-104`,
  `packages/connectors/src/gitlab.ts:86-88`), so a `../` segment can leave
  `REPOSITORY_ROOT` within the same repository. `remove()` does not check the
  slug (`packages/connectors/src/store.ts:302-313`). The upload `directory`
  comes from the client (`packages/runtime/src/routes/admin-media.ts:49`).
- **#86, confirmed.** The media route sends no sandbox CSP and no
  `Content-Disposition` (`packages/runtime/src/routes/admin-media.ts:90-93`),
  `isScriptable` has no caller (`packages/runtime/src/lib/file-type.ts:109`),
  and uploads still accept SVG.
- **#87, confirmed.** `safeReturnTo` accepts `/\evil.example`
  (`packages/auth/oidc/src/routes.ts:38-41`), which browsers read as
  `//evil.example`.
- **#88, confirmed.** No CSP, and the UI loads Google Fonts
  (`packages/runtime/src/middleware/index.ts:58-68`,
  `packages/editor-ui/src/style.css:1`). Fixed in #146.
- **#79, confirmed.** `/health` has no auth and no rate limit, and it calls the
  provider on each request (`packages/runtime/src/routes/health.ts:36`,
  `packages/runtime/src/app.ts:126`).

## V1 Encoding and Sanitization

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 1.2.1 | Output encoding for HTML and HTTP | Pass | `packages/editor-ui/src/views/LoginView.vue:77` | Vue text interpolation; no `v-html` or `innerHTML` in `packages/editor-ui/src`. |
| 1.2.2 | URLs built with encoded data | Pass | `packages/connectors/src/http.ts:55-61`; `packages/auth/oidc/src/routes.ts:120`; `packages/editor-ui/src/api.ts:393` | |
| 1.2.3 | Safe JSON output | Pass | `packages/runtime/src/middleware/index.ts:85,93` | Responses are built with `c.json`. |
| 1.2.4 | Parameterized database queries | Pass | `apps/self-hosted/src/db/drafts.ts:102,114,121` | Placeholders only. |
| 1.2.5 | No OS command injection | Pass | `packages/runtime/src/lib/git.ts:38`; `packages/runtime/src/services/staging-local.ts:269-271` | `execFile` with an argument array, and `--` before paths. |
| 1.3.1 | WYSIWYG HTML sanitized | N/A | — | The server stores Markdoc, not HTML. |
| 1.3.2 | No `eval` or dynamic code | Pass | repository-wide search | No `eval(` or `new Function(`. |
| 1.5.1 | Safe XML parser | N/A | `packages/runtime/src/lib/file-type.ts:67-78` | No XML parser; SVG is found by a text prefix. |

## V2 Validation and Business Logic

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 2.1.1 | Validation rules documented | Partial | `packages/runtime/src/routes/admin-content.ts:30-39` | The rules are in code (zod and the field DSL); no document lists them all. |
| 2.2.1 | Positive input validation | Pass | `packages/runtime/src/routes/admin-content.ts:30-39`; `packages/connectors/src/store.ts:231,331` | The delete slug is not checked; see 5.3.2. |
| 2.2.2 | Validation on the server | Pass | `packages/connectors/src/store.ts:231`; `packages/auth/oidc/src/config.ts:14-62` | |
| 2.3.1 | Business flow in the expected order | Pass | `packages/runtime/src/routes/admin-content.ts:107,173,227` | A save carries the expected revision; a stale save is a conflict. |

## V3 Web Frontend Security

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 3.2.1 | Content cannot render in the wrong context | Fail — #86 | `packages/runtime/src/routes/admin-media.ts:90-93` | SVG is served same-origin with no sandbox. |
| 3.2.2 | Text rendered as text | Pass | `packages/editor-ui/src/views/LoginView.vue:77` | `?error=` is shown as text. |
| 3.3.1 | Cookies `Secure`, with a prefix | Partial | `packages/auth/oidc/src/config.ts:96`; `packages/auth/oidc/src/session.ts:30-31` | N2, N4. `HttpOnly` and `SameSite=Lax` are set (`session.ts:222-244`). |
| 3.4.1 | HSTS on all responses | Fail | `packages/runtime/src/middleware/index.ts:58-68` | N1. |
| 3.4.2 | CORS origin fixed or allowlisted | Pass | `packages/runtime/src/app.ts:114-124`; `packages/runtime/src/middleware/index.ts:132-137` | |
| 3.4.3 | Content-Security-Policy | Fail — #88 | `packages/runtime/src/middleware/index.ts:58-68` | Fixed in #146. ID approximate; can be level 2. |
| 3.5.1 | CSRF: origin check or token | Pass | `packages/runtime/src/middleware/index.ts:146-168`; `packages/auth/oidc/src/gate.ts:97-114` | Origin check plus a double-submit token bound to the session. |
| 3.5.2 | No reliance on a CORS preflight | N/A | — | The preflight is not a control; see 3.5.1. |
| 3.5.3 | No state change on GET | Pass | `packages/runtime/src/routes/admin-content.ts:98,115,163,181,220`; `packages/runtime/src/routes/admin-staging.ts:79,96,101`; `packages/auth/oidc/src/routes.ts:172` | |
| 3.7.x | Redirects only to allowed targets | Fail — #87 | `packages/auth/oidc/src/routes.ts:38-41` | ID and level approximate. |

`nosniff`, `Referrer-Policy` and `X-Frame-Options: DENY` are set
(`packages/runtime/src/middleware/index.ts:62-66`). They are level 2, so they
are not counted.

## V4 API and Web Service

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 4.1.1 | Correct Content-Type with charset | Partial | `packages/runtime/src/routes/admin-spa.ts:19-32,47`; `packages/runtime/src/routes/admin-media.ts:91` | N10. |
| 4.3.x, 4.4.1 | GraphQL; WebSocket over TLS | N/A | — | Mica has neither. |

## V5 File Handling

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 5.2.1 | Size limit without DoS | Partial | `packages/runtime/src/services/media.ts:87`; `packages/runtime/src/routes/admin-media.ts:32` | N3. |
| 5.2.2 | Type from content; extension matches | Pass | `packages/runtime/src/services/media.ts:96-108,184-187`; `packages/runtime/src/lib/file-type.ts:21-64` | The extension comes from the detected type. |
| 5.3.1 | Uploads never run as server code | Pass | `packages/runtime/src/routes/admin-media.ts:62-70` | Uploads are only committed to the repository. |
| 5.3.2 | Paths from user input confined | Fail — #85 | `packages/connectors/src/github.ts:97-104`; `packages/connectors/src/store.ts:302-313`; `packages/runtime/src/routes/admin-media.ts:49,85-87` | The local connector is confined (`packages/core/src/node.ts:65-76`). |

## V6 Authentication

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 6.1.1 | Rate limiting documented | Pass | `docs/decisions.md:359-365`; `packages/auth/oidc/src/config.ts:56-61` | |
| 6.3.1 | Brute-force controls | Pass | `packages/auth/oidc/src/routes.ts:84-91` | The IdP checks credentials; Mica limits sign-in starts per IP. The callback is not limited (N9). |
| 6.3.2 | No default accounts | Pass | `packages/auth/oidc/src/config.ts:176-193` | No accounts; refuses to start without an admission rule. |
| 6.2.x, 6.4.x–6.7.x | Passwords, recovery, MFA, out-of-band, authenticators | N/A | `packages/auth/oidc/src/oidc.ts:1-11` | The identity provider does these. |

## V7 Session Management

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 7.2.1 | Session checked on the server | Pass | `packages/auth/oidc/src/gate.ts:55`; `packages/auth/oidc/src/session.ts:169-185,203-208` | |
| 7.2.2 | Dynamic tokens, not static keys | Pass | `packages/auth/oidc/src/session.ts:188-200` | |
| 7.2.3 | Reference token entropy ≥ 128 bits | N/A | `packages/auth/oidc/src/session.ts:195` | The session is self-contained (V9). The CSRF token has 256 bits. |
| 7.2.4 | New token at authentication | Pass | `packages/auth/oidc/src/routes.ts:161`; `packages/auth/oidc/src/session.ts:263-272` | |
| 7.4.1 | Session unusable after logout | Fail — accepted | `packages/auth/oidc/src/session.ts:15-18`; `packages/auth/oidc/src/routes.ts:172-174` | "Sessions are encrypted cookies, not rows" in `decisions.md`: a copied cookie stays valid until it expires. |
| 7.4.2 | Sessions end when access is removed | Partial | `packages/auth/oidc/src/gate.ts:63-70`; `packages/auth/oidc/src/config.ts:53-54` | A rule change is immediate; a change at the provider waits for the next sign-in. |

The idle and absolute timeouts are implemented
(`packages/auth/oidc/src/session.ts:154-155`). They are level 2.

## V8 Authorization

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 8.1.1 | Authorization rules documented | Pass | `packages/auth/oidc/src/admission.ts:1-29`; `docs/self-hosting.md:236-252` | |
| 8.2.1 | Function-level access control | Pass | `packages/runtime/src/app.ts:136`; `packages/auth/oidc/src/gate.ts:53-86` | |
| 8.2.2 | Data-level access (IDOR) | Pass | `packages/runtime/src/app.ts:133-135` | One site and one role, by design. |
| 8.3.1 | Enforced on the server | Pass | `packages/auth/oidc/src/gate.ts:63` | Admission is checked on every request. |

## V9 Self-contained Tokens

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 9.1.1 | Signature or MAC checked before use | Pass | `packages/auth/oidc/src/session.ts:174-180`; `packages/auth/oidc/src/oidc.ts:94,197` | GCM tag for the session, HMAC for the transaction cookie, `openid-client` for the ID token. |
| 9.1.2 | Algorithm allowlist, no `none` | Pass | `packages/auth/oidc/src/session.ts:159,174`; `packages/auth/oidc/src/oidc.ts:73` | ID approximate. |
| 9.1.3 | Keys from trusted sources | Pass | `packages/auth/oidc/src/session.ts:144-146`; `apps/self-hosted/src/config.ts:94-99`; `packages/auth/oidc/src/oidc.ts:131-140` | `SESSION_SECRET` is required in production; JWKS from discovery. |
| 9.2.1 | Validity period enforced | Pass | `packages/auth/oidc/src/session.ts:206`; `packages/auth/oidc/src/oidc.ts:101` | |

## V10 OAuth and OIDC (relying party)

The levels in this chapter are approximate; several requirements can be level
2. They are listed because they are the core of the sign-in.

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 10.1.1 | Tokens only where needed | Pass | `packages/auth/oidc/src/oidc.ts:224,245-252` | The access token is used once, for userinfo, and not stored. |
| 10.2.1 | Code flow with PKCE and state | Pass | `packages/auth/oidc/src/oidc.ts:163-178,197-201` | S256; the redirect URI is fixed (`oidc.ts:119`). |
| 10.5.1 | Nonce checked | Pass | `packages/auth/oidc/src/oidc.ts:166,200` | |
| 10.5.2 | User identified by issuer and subject | Pass | `packages/auth/oidc/src/admission.ts:47-54,118` | Email rules need `email_verified`. |
| 10.5.3 | ID token issuer, audience and expiry checked | Pass | `packages/auth/oidc/src/oidc.ts:132-133,197` | By `openid-client`. ID approximate. |
| 10.4.x | Authorization server requirements | N/A | — | The IdP is the authorization server. |

## V11 Cryptography

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 11.3.1 | No ECB or weak padding | Pass | `packages/auth/oidc/src/session.ts:159` | |
| 11.3.2 | Approved authenticated cipher | Pass | `packages/auth/oidc/src/session.ts:158-161` | AES-256-GCM, random 96-bit IV, HKDF-derived key. |
| 11.4.1 | Approved hash functions | Pass | `packages/auth/oidc/src/oidc.ts:73`; `packages/connectors/src/local.ts:84` | SHA-256 only. |
| 11.5.1 | CSPRNG for secrets | Pass | `packages/runtime/src/lib/id.ts:61`; `packages/auth/oidc/src/oidc.ts:163-166` | ID approximate. |

## V12 Secure Communication

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 12.1.1 | Current TLS versions only | N/A | `docs/self-hosting.md:225-234` | The operator's proxy terminates TLS. |
| 12.2.1 | TLS for all client connections | Partial | `packages/auth/oidc/src/config.ts:96` | N2. `REPOSITORY_API_BASE` also accepts `http://` (`packages/runtime/src/config.ts:79`). |
| 12.2.2 | Publicly trusted certificates | N/A | — | The proxy holds the certificate. |

## V13 Configuration

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 13.4.1 | No source-control metadata exposed | Pass | `packages/runtime/src/routes/admin-spa.ts:40,57-61`; `packages/runtime/src/app.ts:149-167` | Only the SPA build is served. |
| 13.4.2 | Debug mode off in production | Pass | `Dockerfile:73` | The image sets `NODE_ENV=production`. ID approximate. |
| 13.4.x | No needless information on anonymous endpoints | Partial | `packages/runtime/src/routes/health.ts:42-47` | N8. ID approximate. |
| 13.x | Anonymous endpoint uses provider quota | Fail — #79 | `packages/runtime/src/routes/health.ts:36`; `packages/runtime/src/app.ts:107,126` | ID approximate. |

## V14 Data Protection

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 14.2.1 | Sensitive data not in the URL | Partial | `packages/auth/oidc/src/routes.ts:154-157` | N6. Tokens are in cookies only. |
| 14.3.1 | Client data cleared at logout | Pass | `packages/auth/oidc/src/routes.ts:173-174`; `packages/editor-ui/src/stores/session.ts:75-87` | No web storage; media is cached `private, max-age=60`. |

## V16 Security Logging and Error Handling

The IDs and levels in this chapter are approximate.

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 16.3.1 | Authentication events logged | Pass | `packages/auth/oidc/src/routes.ts:150,166`; `packages/auth/oidc/src/gate.ts:65` | |
| 16.4.1 | Log injection prevented | Partial | `packages/runtime/src/lib/logger.ts:53-60`; `packages/runtime/src/middleware/index.ts:23` | JSON lines escape values; the request id is not checked (N7). |
| 16.5.1 | Generic error to the client | Pass | `packages/runtime/src/middleware/index.ts:88-102` | The stack stays in the log. |

## Next review

Review again before 1.0, after the tracked and new findings are fixed, and when
the authentication, session or upload code changes in a way that this table
does not cover.

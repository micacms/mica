# Security self-review: OWASP ASVS 5.0.0, level 1

This is the self-review that
[decision record 34](adr/0034-a-hobby-project-without-audits.md) asks for. It is not an
independent audit. Anybody can check it: every result names the code that it
is based on, by file and, where it helps, by function. Line numbers are left
out, because they go out of date with each change.

## Scope

- **Standard:** OWASP ASVS 5.0.0, level 1 requirements only.
- **Date:** 2026-10-14. The first review was on 2026-10-11, at `c870834`.
- **Reviewer:** the maintainer, with an AI reviewer.
- **Basis:** `main` at `dd83c41`, after 0.8.0.
- **Method:** reading the code, and running the Markdoc renderer once with
  hostile input. No scanner or live attack was run.
- **Code reviewed:**
  - `packages/auth/oidc/src/`: the sign-in, the session, the admission rules
    and the gate.
  - `packages/runtime/src/`: the app, the middleware, the routes, the content
    and media services, the rate limit, the logger, the file layer and the
    Git working tree.
  - `packages/core/src/`: the path helpers (`source.ts`, `node.ts`), the rich
    text (`rich-text.ts`) and the manifest reader (`manifest.ts`).
  - `packages/astro/src/`: the rich-text renderer and the image paths.
  - `apps/local-editor/src/` and `apps/self-hosted/src/`.
- **Not reviewed:** the identity provider, and the website's own templates.

## Summary

| Status | Count |
| --- | --- |
| Pass | 54 |
| Partial | 3: 2.1.1, 7.4.2, 14.3.1 |
| Fail | 0 |
| Accepted | 1: 7.4.1 |
| N/A | 10 (some rows group several requirements) |

Every finding of the first review is fixed. This review found eight new
ones, all low or lower. #213 tracks them.

### Findings of the first review, fixed

| # | Finding | Fixed in |
| --- | --- | --- |
| N1 | No `Strict-Transport-Security` header. | #157 |
| N2 | Production started with an `http://` public URL, and the cookies were not `Secure`. | #157, #161; since #233 an `http://` address is allowed only on this machine |
| N3 | An upload was read into memory before its size was checked. | #158, partly: see N13 |
| N4 | Cookie names had no `__Host-` or `__Secure-` prefix. | #157 |
| N5 | With `MICA_TRUST_PROXY=true`, the left-most `X-Forwarded-For` entry was used. | #159 |
| N6 | A refused sign-in put the email address in the URL. | #160 |
| N7 | `x-request-id` came from the client unchecked. | #160 |
| N8 | Anonymous `/health` showed the repository and the uptime. | #156 |
| N9 | The OIDC callback was not rate limited. | #159 |
| N10 | Text media were sent without a `charset`. | #160 |
| #79 | `/health` called the provider on each request. | #156 |
| #85 | A `../` segment could leave the content root in the provider connectors. | #153 |
| #86 | Media were served same-origin with no sandbox, and SVG was accepted. | #154 |
| #87 | `safeReturnTo` accepted `/\evil.example`. | #155 |
| #88 | No Content-Security-Policy, and the editor loaded Google Fonts. | #146 |

### New findings

| # | Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| N11 | low | The local editor follows a symbolic link inside the content root. `within` checks the path as text, so a committed link to a folder outside the root makes a save write, and a delete remove, outside it. The self-hosted clone has no links (`core.symlinks=false`). | `packages/core/src/node.ts` (`within`); `packages/runtime/src/workspace/files.ts` | Refuse a path whose real location leaves the real content root. |
| N12 | low | The `:slug` of `PUT /entries/:slug` does not get the one-segment check that a delete has. `x%2Fmedia` with a new URL removes another entry's media folder, inside the root. | `packages/runtime/src/routes/admin-content.ts`; `packages/runtime/src/services/content-store.ts` (`save`) | Check the slug parameter of get, save and references. |
| N13 | low | One upload request can hold about 251 MB in memory: the form is buffered and each file copied, against a 512 MB container. Admitted editors only. | `packages/runtime/src/middleware/index.ts` (body limit); `packages/runtime/src/routes/admin-media.ts` | Lower the limit for one request, and prepare the files one after another. Since #235, an upload is one file that streams to disk. |
| N14 | low | Unsaved form values kept in `sessionStorage` (`mica:kept:*`) stay after sign-out in the same tab. Website content, not secrets. A regression of #197. | `packages/editor-ui/src/composables/useKeptChanges.ts`; `packages/editor-ui/src/stores/session.ts` (`signOut`) | Remove the keys at sign-out. |
| N15 | low | A `media()` value is not checked for `..`. A hand-committed `/../../x.png` reaches Astro's `image()`, which can put a file from outside the content root into the build; Mica's Publish refuses it as missing. Needs write access to the repository. | `packages/core/src/validation.ts`; `packages/core/src/read.ts`; `packages/astro/src/images.ts` | Refuse media paths that `contentPath` refuses. |
| N16 | low | `requireCollection` and `requireSingleton` accept inherited names such as `constructor`, and a save then fails with a 500. | `packages/runtime/src/services/content-store.ts` | `Object.hasOwn`. |
| N17 | none | The media route removes its prefix with a greedy pattern, so a file under a collection named `file` gives the wrong file or a 404. The path stays inside the root. | `packages/runtime/src/routes/admin-media.ts` | Remove only the route prefix. |
| N18 | none | A Markdoc tag or node that a project adds through `options.config` gets no URL check. The built-in nodes refuse `javascript:` and `data:` links. | `packages/astro/src/richtext.ts` | Say in the docs that a custom tag must check its URL attributes. |

## V1 Encoding and Sanitization

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 1.2.1 | Output encoding for HTML and HTTP | Pass | `packages/editor-ui/src/views/LoginView.vue` | Vue text interpolation; no `v-html` or `innerHTML` in `packages/editor-ui/src`. |
| 1.2.2 | URLs built with encoded data | Pass | `packages/auth/oidc/src/routes.ts`; `packages/editor-ui/src/api.ts` | |
| 1.2.3 | Safe JSON output | Pass | `packages/runtime/src/middleware/index.ts` (error handler) | Responses are built with `c.json`. |
| 1.2.4 | Parameterized database queries | N/A | — | Mica has no database. |
| 1.2.5 | No OS command injection | Pass | `packages/runtime/src/workspace/git.ts`; `packages/runtime/src/workspace/tree.ts`; `apps/self-hosted/src/config.ts` (`isBranchName`) | `execFile` with an argument array, `--` before paths, literal pathspecs, and a checked branch name. No shell. |
| 1.3.1 | WYSIWYG HTML sanitized | N/A | `packages/astro/src/richtext.ts` | Mica stores Markdoc, not HTML. Markdoc renders raw HTML as text and refuses `javascript:` and `data:` links. See N18. |
| 1.3.2 | No `eval` or dynamic code | Pass | repository-wide search | The only `new Function(` is in a test. |
| 1.5.1 | Safe XML parser | N/A | `packages/runtime/src/lib/file-type.ts` | No XML parser; SVG is found by a text prefix and refused. |

## V2 Validation and Business Logic

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 2.1.1 | Validation rules documented | Partial | `sites/micacms/content/docs/reference-fields/body.mdoc`; `packages/runtime/src/routes/admin-content.ts` | The field rules are documented. The accepted upload types are in `docs/adr/0018-media-files.md`. Not yet: the 2 MB limit for JSON. |
| 2.2.1 | Positive input validation | Pass | `packages/runtime/src/routes/admin-content.ts`; `packages/runtime/src/services/content-store.ts` | The delete slug is checked; the save slug is not (N12). |
| 2.2.2 | Validation on the server | Pass | `packages/runtime/src/services/content-store.ts` (`validate`); `packages/auth/oidc/src/config.ts` | |
| 2.3.1 | Business flow in the expected order | Pass | `packages/runtime/src/routes/admin-content.ts`; `packages/runtime/src/services/staging.ts` (`unreviewed`) | Save, delete, reorder, discard and publish carry the revision that the editor saw (#216). |

## V3 Web Frontend Security

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 3.2.1 | Content cannot render in the wrong context | Pass | `packages/runtime/src/routes/admin-media.ts`; `packages/runtime/src/services/media.ts` | Media get `sandbox; default-src 'none'`, a file that is not an image is a download, and SVG is refused (#154). |
| 3.2.2 | Text rendered as text | Pass | `packages/editor-ui/src/views/LoginView.vue` | `?error=` is a code that maps to fixed text. |
| 3.3.1 | Cookies `Secure`, with a prefix | Pass | `packages/auth/oidc/src/session.ts`; `apps/self-hosted/src/config.ts` | `__Host-` (`__Secure-` for the transaction cookie) when Secure; `http://` only on this machine (#157, #161, #233). |
| 3.4.1 | HSTS on all responses | Pass | `packages/runtime/src/middleware/index.ts` | `max-age=31536000` when the public URL is `https://` (#157). |
| 3.4.2 | CORS origin fixed or allowlisted | Pass | `packages/runtime/src/app.ts`; `packages/runtime/src/middleware/index.ts` (`allowedOrigins`) | |
| 3.4.3 | Content-Security-Policy | Pass | `packages/runtime/src/middleware/index.ts` (`contentSecurityPolicy`); `packages/core/src/map.ts`; `packages/editor-ui/src/style.css` | `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`; local fonts (#146). Only when the model has a map: its hosts in `img-src` and `connect-src`, and `blob:` in `worker-src` (#278). No `'unsafe-eval'`. ID approximate. |
| 3.5.1 | CSRF: origin check or token | Pass | `packages/runtime/src/middleware/index.ts` (`originGuard`); `packages/auth/oidc/src/gate.ts` | Origin check plus a double-submit token bound to the session. Sign-out has the origin check only (#213). |
| 3.5.2 | No reliance on a CORS preflight | N/A | — | The preflight is not a control; see 3.5.1. |
| 3.5.3 | No state change on GET | Pass | `packages/runtime/src/routes/`; `packages/auth/oidc/src/routes.ts` | |
| 3.7.x | Redirects only to allowed targets | Pass | `packages/auth/oidc/src/return-to.ts` | The target must have the public URL's origin and an `/admin` path (#155). ID and level approximate. |

`nosniff`, `Referrer-Policy` and `X-Frame-Options: DENY` are set
(`packages/runtime/src/middleware/index.ts`). They are level 2, so they are
not counted.

A `coordinates({ map })` field makes the editor's browser load a style, tiles,
glyphs and sprites from a third-party host (#278). The host sees the editor's
IP address and the area of the map. Without `map`, the editor loads nothing
from another host. The model names the hosts, and each host must be an `https`
origin (`mapProblem` in `packages/core/src/map.ts`). The model is committed
with the content, so a key in a style address is public: use a key that the
tile host limits to the address of the editor.

## V4 API and Web Service

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 4.1.1 | Correct Content-Type with charset | Pass | `packages/runtime/src/routes/admin-media.ts`; `packages/runtime/src/routes/admin-spa.ts` | Text media get `; charset=utf-8` (#160). |
| 4.3.x, 4.4.1 | GraphQL; WebSocket over TLS | N/A | — | Mica has neither. |

## V5 File Handling

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 5.2.1 | Size limit without DoS | Pass | `packages/runtime/src/middleware/index.ts`; `packages/runtime/src/services/media.ts` | A JSON body is refused over 2 MB before it is read (#158). An upload is one file that streams to disk; the stream stops at `MICA_MAX_UPLOAD_BYTES`, and a Content-Length over it is refused at once (#235). |
| 5.2.2 | Type from content; extension matches | Pass | `packages/runtime/src/services/media.ts`; `packages/runtime/src/lib/file-type.ts` | The extension comes from the detected type. |
| 5.3.1 | Uploads never run as server code | Pass | `packages/runtime/src/routes/admin-media.ts` | Uploads are files in the content, never served as code. |
| 5.3.2 | Paths from user input confined | Pass | `packages/core/src/source.ts` (`contentPath`); `packages/core/src/node.ts` (`within`); `packages/runtime/src/workspace/files.ts`; `packages/runtime/src/services/media.ts` | One check refuses `.`, `..`, `\`, control characters and drive letters, and uploads go only into a `media` folder (#153). Gaps: N11, N12, N15. |

## V6 Authentication

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 6.1.1 | Rate limiting documented | Pass | `docs/adr/0004-sealed-sessions-and-no-state-about-people.md`; `packages/auth/oidc/src/config.ts` | |
| 6.3.1 | Brute-force controls | Pass | `packages/auth/oidc/src/routes.ts` | The provider checks credentials; Mica limits sign-in starts and callbacks for each address (#159). |
| 6.3.2 | No default accounts | Pass | `packages/auth/oidc/src/config.ts` (`requireAuthConfig`) | No accounts; refuses to start without an admission rule. |
| 6.2.x, 6.4.x–6.7.x | Passwords, recovery, MFA, out-of-band, authenticators | N/A | `packages/auth/oidc/src/oidc.ts` | The identity provider does these. |

## V7 Session Management

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 7.2.1 | Session checked on the server | Pass | `packages/auth/oidc/src/gate.ts`; `packages/auth/oidc/src/session.ts` | |
| 7.2.2 | Dynamic tokens, not static keys | Pass | `packages/auth/oidc/src/session.ts` | |
| 7.2.3 | Reference token entropy ≥ 128 bits | N/A | `packages/auth/oidc/src/session.ts` | The session is self-contained (V9). The CSRF token has 256 bits. |
| 7.2.4 | New token at authentication | Pass | `packages/auth/oidc/src/routes.ts`; `packages/auth/oidc/src/session.ts` | |
| 7.4.1 | Session unusable after logout | Accepted | `packages/auth/oidc/src/session.ts`; `docs/adr/0004-sealed-sessions-and-no-state-about-people.md` | A copied cookie stays valid until it expires. |
| 7.4.2 | Sessions end when access is removed | Partial | `packages/auth/oidc/src/gate.ts`; `packages/auth/oidc/src/config.ts` | A rule change takes effect after a restart; a change at the provider waits for the next sign-in, at most 8 hours by default. |

The idle and absolute timeouts are implemented
(`packages/auth/oidc/src/session.ts`). They are level 2.

## V8 Authorization

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 8.1.1 | Authorization rules documented | Pass | `packages/auth/oidc/src/admission.ts`; `sites/micacms/content/docs/self-hosting/body.mdoc` | |
| 8.2.1 | Function-level access control | Pass | `packages/runtime/src/app.ts`; `packages/auth/oidc/src/gate.ts` | |
| 8.2.2 | Data-level access (IDOR) | Pass | `packages/runtime/src/app.ts` | One site and one role, by design. |
| 8.3.1 | Enforced on the server | Pass | `packages/auth/oidc/src/gate.ts` | Admission is checked on every request. |

## V9 Self-contained Tokens

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 9.1.1 | Signature or MAC checked before use | Pass | `packages/auth/oidc/src/session.ts`; `packages/auth/oidc/src/oidc.ts` | GCM tag for the session, HMAC for the transaction cookie, `openid-client` for the ID token. |
| 9.1.2 | Algorithm allowlist, no `none` | Pass | `packages/auth/oidc/src/session.ts`; `packages/auth/oidc/src/oidc.ts` | ID approximate. |
| 9.1.3 | Keys from trusted sources | Pass | `packages/auth/oidc/src/session.ts`; `apps/self-hosted/src/config.ts`; `packages/auth/oidc/src/oidc.ts` | `MICA_SESSION_SECRET` is required, also for a trial (#233); JWKS from discovery. |
| 9.2.1 | Validity period enforced | Pass | `packages/auth/oidc/src/session.ts`; `packages/auth/oidc/src/oidc.ts` | |

## V10 OAuth and OIDC (relying party)

The levels in this chapter are approximate; several requirements can be level
2. They are listed because they are the core of the sign-in.

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 10.1.1 | Tokens only where needed | Pass | `packages/auth/oidc/src/oidc.ts` | The access token is used once, for userinfo, and not stored. |
| 10.2.1 | Code flow with PKCE and state | Pass | `packages/auth/oidc/src/oidc.ts` | S256; the redirect URI is fixed. |
| 10.5.1 | Nonce checked | Pass | `packages/auth/oidc/src/oidc.ts` | |
| 10.5.2 | User identified by issuer and subject | Pass | `packages/auth/oidc/src/admission.ts` | Email rules need `email_verified`. |
| 10.5.3 | ID token issuer, audience and expiry checked | Pass | `packages/auth/oidc/src/oidc.ts` | By `openid-client`. ID approximate. |
| 10.4.x | Authorization server requirements | N/A | — | The identity provider is the authorization server. |

## V11 Cryptography

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 11.3.1 | No ECB or weak padding | Pass | `packages/auth/oidc/src/session.ts` | |
| 11.3.2 | Approved authenticated cipher | Pass | `packages/auth/oidc/src/session.ts` | AES-256-GCM, random 96-bit IV, HKDF-derived key. |
| 11.4.1 | Approved hash functions | Pass | `packages/auth/oidc/src/oidc.ts`; `packages/runtime/src/workspace/files.ts` | SHA-256 only. |
| 11.5.1 | CSPRNG for secrets | Pass | `packages/runtime/src/lib/id.ts`; `packages/auth/oidc/src/oidc.ts` | ID approximate. |

## V12 Secure Communication

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 12.1.1 | Current TLS versions only | N/A | `sites/micacms/content/docs/self-hosting/body.mdoc` | The operator's proxy terminates TLS. |
| 12.2.1 | TLS for all client connections | Pass | `apps/self-hosted/src/config.ts`; `apps/self-hosted/src/workspace/credentials.ts` (`parseRemote`); `packages/auth/oidc/src/config.ts` | The public URL, the issuer and the repository need `https://`, except on this machine (#157, #161, #233). |
| 12.2.2 | Publicly trusted certificates | N/A | — | The proxy holds the certificate. |

## V13 Configuration

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 13.4.1 | No source-control metadata exposed | Pass | `packages/runtime/src/routes/admin-spa.ts`; `packages/runtime/src/app.ts` | Only the editor's build is served. |
| 13.4.2 | Debug mode off in production | Pass | `Dockerfile` | Mica has no debug mode (#233). The image sets `NODE_ENV=production` for its libraries. ID approximate. |
| 13.4.x | No needless information on anonymous endpoints | Pass | `packages/runtime/src/routes/health.ts`; `apps/self-hosted/src/index.ts` | `/health` sends only `status`; `/ready` sends short reason codes and the time of the last sync (#156, #232). ID approximate. |
| 13.x | Anonymous endpoint uses provider quota | Pass | `packages/runtime/src/routes/health.ts` | `/health` does no I/O; `/ready` is cached and uses the clone's state (#156). ID approximate. |

## V14 Data Protection

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 14.2.1 | Sensitive data not in the URL | Pass | `packages/auth/oidc/src/routes.ts` | A refused sign-in redirects with an error code (#160). Tokens are in cookies only. |
| 14.3.1 | Client data cleared at logout | Partial | `packages/auth/oidc/src/routes.ts`; `packages/editor-ui/src/stores/session.ts` | The cookies are cleared, and media are cached `private, max-age=60`. Unsaved form values stay in `sessionStorage` (N14). |

## V16 Security Logging and Error Handling

The IDs and levels in this chapter are approximate.

| ID | Requirement (short) | Status | Evidence | Note |
| --- | --- | --- | --- | --- |
| 16.3.1 | Authentication events logged | Pass | `packages/auth/oidc/src/routes.ts`; `packages/auth/oidc/src/gate.ts` | |
| 16.4.1 | Log injection prevented | Pass | `packages/runtime/src/lib/logger.ts`; `packages/runtime/src/middleware/index.ts` | JSON lines escape values; a request ID must match `^[A-Za-z0-9_-]{1,64}$` (#160). |
| 16.5.1 | Generic error to the client | Pass | `packages/runtime/src/middleware/index.ts` | The stack stays in the log. |

## Git workspace

The self-hosted Mica runs `git` on a repository that someone else controls,
with a token. These rows are threats, not ASVS requirements, so the counts in
the summary do not include them.

| Threat | Status | Evidence | Note |
| --- | --- | --- | --- |
| Repository-controlled Git behaviour: hooks, filters, `.gitattributes`, symlinks, other protocols, submodules | Pass | `apps/self-hosted/src/workspace/isolation.ts` (`managedEnvironment`, `writeIsolationAttributes`); `apps/self-hosted/src/workspace/clone.ts` | No system or global Git configuration. `core.hooksPath` is `/dev/null`, `core.symlinks` is `false`, `info/attributes` turns off conversion and `ident`, only HTTPS is allowed (`http` only on this machine), and submodules are never fetched. The only filter driver is Git LFS's, from the environment; the repository cannot add one. `lfs.url` and `lfs.pushurl` from the environment override `.lfsconfig`, so the content cannot send the LFS files to another server. |
| Credential leak to another host, to a file, to a log or to the editor | Pass | `apps/self-hosted/src/workspace/credentials.ts` (`parseRemote`, `redact`); `apps/self-hosted/src/workspace/isolation.ts` (`HELPER`) | The token is not in the URL. A credential helper for the configured host, and for the host of `MICA_REPOSITORY_LFS_URL` when the operator sets one, answers `get` only, from the environment of that process or from the token file. The environment of `git` is an allowlist. `redact` removes the current token from logs and messages. |
| Disk use: a clone that grows without limit | Partial | `apps/self-hosted/src/workspace/managed.ts` (`sizeOf`) | The System page shows the clone size, the LFS store included; there is no quota. Git LFS downloads only the files under the content root. `compact` removes old versions. |
| Path or option injection through the branch or the content root | Pass | `apps/self-hosted/src/config.ts` (`isBranchName`, the root check); `packages/runtime/src/workspace/tree.ts` | |
| A second process writes to the volume | Pass | `apps/self-hosted/src/workspace/lease.ts` | A lease with a heartbeat: a second Mica waits for it to expire, then refuses to start (#229). |
| A rich-text image or link leaves the content root | Pass | `packages/core/src/rich-text.ts` (`resolveMarkdocTarget`); `packages/astro/src/images.ts` | A path above the root resolves to nothing; only files inside the root reach Astro's `image()`. Media fields: N15. |
| A pushed content model widens the editor's Content-Security-Policy | Pass | `packages/core/src/map.ts` (`mapProblem`, `mapHosts`); `packages/runtime/src/middleware/index.ts` | Only through `coordinates({ map })`, and only with `https` origins in `img-src` and `connect-src`. A host cannot carry a path, a space or a `;`, so it cannot add a directive. A person who can push the model can already change the content. |
| A pushed content model runs code | Pass | `packages/core/src/manifest.ts` (`readManifest`) | The manifest is data. A text pattern that repeats a group with a repeat inside, such as `(a+)+`, is refused when the model loads (#215). Overlapping alternatives, such as `(a|a)+`, are still possible. |

## Next review

Review again before 1.0, after the new findings are fixed, and when the
authentication, session, upload or Git code changes in a way that this table
does not cover.

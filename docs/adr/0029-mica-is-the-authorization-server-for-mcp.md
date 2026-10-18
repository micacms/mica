# 29. A self-hosted Mica is the authorization server of its MCP endpoint

**Status:** Accepted

## Context

The MCP specification needs a token for this resource. Google gives opaque access tokens, and other providers need mappers for the audience and the claims. Admission by email with Google would not work with tokens from the provider.

## Decision

- In the image, Mica is the OAuth 2.1 authorization server for `/mcp`. The person signs in with the editor's OIDC flow, the admission rules decide, and a consent page asks the person to allow one agent.
- Mica issues sealed tokens (AES-256-GCM under a key from `MICA_SESSION_SECRET`). It stores no clients, codes or tokens.
- A client is a Client ID Metadata Document, which Mica fetches with limits (https only, no private address, no redirect, 64 kB, 5 seconds, cached 5 minutes), or a dynamic registration that Mica seals into the client ID.
- The authorization endpoint first needs an admitted person who signed in in the last five minutes. Each error before the consent stays on Mica's page, to prevent an open redirect. The consent page says that the name of a registered client is not confirmed.
- A loopback redirect URI matches on any port (RFC 8252), because a native client picks a free port.
- An access token lives one hour. A grant ends when the sign-in would end. The admission rules are checked on each request and each refresh.
- Scopes: `content:read`, `content:write`, and `content:publish` only with `MICA_MCP_PUBLISH`.

## Consequences

- Each provider that the editor supports works, with no change at the provider.
- Mica cannot revoke one token. A copied refresh token works until the grant ends. A new `MICA_SESSION_SECRET` ends all grants.
- A refresh gives a new refresh token, but the old one stays valid until the grant ends. OAuth 2.1 asks for rotation for a public client, and a sealed token cannot rotate without stored state.
- A code is single-use only in the memory of the process. After a restart, its 60-second life and PKCE remain.
- Change this decision when: each provider issues tokens for Mica's audience with the claims. Then Mica can be only a resource server.

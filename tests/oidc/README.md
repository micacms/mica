# Automated OIDC test

The real Mica image against a real [Dex](https://dexidp.io) or a real
[Pocket ID](https://pocket-id.org), publishing to a real Git host,
[Forgejo](https://forgejo.org), driven by a Node script with no dependencies. CI runs it on every pull request that can change the image, in
[`image.yml`](../../.github/workflows/image.yml).

It proves what unit tests cannot: a real OpenID Connect round trip — discovery,
PKCE, `state`, `nonce`, the ID token — and a clone, a save and a publication
over Git, with the container as it is deployed.

## What it checks

| Who                      | Rule                 | Expected               |
| ------------------------ | -------------------- | ---------------------- |
| `alice@gmail.com`        | `MICA_ADMIT_EMAILS`  | Admitted               |
| `bob@harborlane.example` | `MICA_ADMIT_DOMAINS` | Admitted               |
| `carol@pinecrest.example` | `MICA_ADMIT_GROUPS` (`mica-editors`) | Admitted |
| `dave@pinecrest.example` | none (group `everyone`) | Authenticated, refused |
| `mallory@gmail.com`      | none                 | Authenticated, refused |

And, for an admitted session:

- no admin API without a session, and no write without the CSRF token;
- a save is a draft: the repository does not move;
- Publish makes one commit on top of the old head, by the editor who pressed it,
  committed by Mica;
- an altered session cookie is refused;
- sign-out clears both cookies;
- Git LFS: the seed gives `*.png` under the content root to LFS, and Forgejo
  serves LFS. An uploaded PNG is published as a pointer, with the image in
  Forgejo's LFS store. A PNG that Forgejo adds reaches Mica with a sync.

With Dex, all five users have the password `password`. Dex reports every
address as verified, as Google does. Mica asks for the `groups` scope, because
Dex sends the groups claim only then.

## Run it

```bash
docker compose -f tests/oidc/compose.yml up -d --build --wait
node --test tests/oidc/flow.test.mjs
docker compose -f tests/oidc/compose.yml down -v
```

The ports are 5556 (Dex), 6422 (Mica) and 3000 (Forgejo). When port 3000 is in use, set `FORGEJO_PORT=3001` for `docker compose` and for the tests. A one-shot
`forgejo-seed` service creates the user `editor` and the repository
`editor/site` from the example content. Mica uses the account password where a
token would go, which Forgejo accepts. Run `down -v` to start again from the
example content.

The login rate limit of this stack is 50 attempts in 15 minutes. One run uses
11, and the browser test uses 8. After a few runs, restart the `mica` service.

## Run it with Pocket ID

The same five people, the same rules and the same checks, with Pocket ID as the
provider:

```bash
docker compose -f tests/oidc/compose.pocket-id.yml up -d --build --wait
OIDC_PROVIDER=pocket-id node --test tests/oidc/flow.test.mjs
docker compose -f tests/oidc/compose.pocket-id.yml down -v
```

Pocket ID signs in with passkeys, so the script cannot post a password. It
seeds Pocket ID over the admin API, with a static API key: the client, the five
people and their groups. For each sign-in, it gets a one-time access token for
the person and logs in with it. The client needs no consent, so the
authorization request then goes straight back to Mica. The image is pinned to
one version. A new version can need a change in `flow.test.mjs`.

Mica is a public client here: PKCE alone, no secret. Pocket ID sends the
groups claim only for the `groups` scope, so Mica asks for it. The rate limit
of Pocket ID is off, because the test logs in 11 times from one address. The
ports are 1411 (Pocket ID), 6422 (Mica) and 3000 (Forgejo). When a port is in
use, set `MICA_PORT` or `FORGEJO_PORT` for `docker compose` and for the tests.

## What it does not check

- **Other shapes of the groups claim.** Dex and Pocket ID send bare group names. A Keycloak
  path (`/mica-editors`) and the claim of Entra are covered by unit tests and by
  the manual Keycloak rig in [`tests/e2e/`](../e2e/README.md).
- **GitHub and GitLab.** Forgejo is a real Git host, but the hosts that Mica
  supports are checked by the weekly live workflow, not here.
- **The passkey sign-in of Pocket ID.** The test logs in with a one-time access
  token. What Mica receives afterwards is the same ID token.
- **The editor UI.** No browser is involved here.
  [`tests/browser/`](../browser/README.md) drives the editor on this stack.

> Deliberately insecure: plain HTTP, committed secrets, one password for
> everybody (Dex), and a committed API key (Pocket ID). A test rig, not an example deployment.

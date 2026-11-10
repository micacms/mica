# The demo stack

Mica in its deployed shape, on your machine: the CMS from its image, a real
identity provider, and a real repository on github.com, gitlab.com or any Git
host over HTTPS.

```bash
cp deploy/demo-identity/.env.example deploy/demo-identity/.env   # your repository and its token
docker compose -f deploy/demo-identity/compose.yml up
```

When the stack is up, the log of `seed-identity` shows a sign-in link for each of
three people. Open the link of alice in your browser, then open
<http://localhost:6422/admin/>. To see the links again, run
`docker compose -f deploy/demo-identity/compose.yml logs seed-identity`. A link
works once: see "What starts by itself" below for a new one.
The stack runs the published image of this checkout's release; to try the code
of this checkout, swap the image for the build block in `compose.yml` and add
`--build`.

Two containers — Mica keeps no database, and Pocket ID keeps its data in a file:

| Service | What it is |
| --- | --- |
| `mica` | Mica itself: one Node process, and its clone of your repository |
| `pocket-id` | The identity provider, [Pocket ID](https://pocket-id.org) |
| `seed-identity` | A one-shot job. It exits and stays exited |

Your content repository is the third part, and it is deliberately not in here.
Mica pushes to a repository you already own, and your website is built from
that repository by CI that never contacts Mica.

> Deliberately local: plain HTTP, and an encryption key and an API key in the
> Compose file that anybody can read. It is a demo, not an example deployment. The reference
> deployment is [deploy/self-hosted/compose.yml](../self-hosted/compose.yml) —
> see [docs/self-hosting.md](../../docs/self-hosting.md).

---

## What starts by itself

Nothing has to be configured. Pocket ID generates the client secret when a
client is created, so [`seed/seed-identity.sh`](seed/seed-identity.sh)
registers Mica as an OIDC client over Pocket ID's API and leaves the secret in a
volume that the CMS reads at start. The same script creates three people:

| Person | What happens |
| --- | --- |
| `alice` | Admitted: her subject is in `MICA_ADMIT_SUBJECTS` |
| `bob` | Admitted the same way, and with exactly the same powers |
| `mallory` | Authenticates perfectly, and is refused |

**Pocket ID has no passwords.** People sign in with a passkey. The seed script
prints a sign-in link for each person. A link signs the person in once, within
a day. To sign in again later, open the account page of Pocket ID
(<http://localhost:1411/settings/account>) and add a passkey. To get a fresh link, run:

```bash
docker compose -f deploy/demo-identity/compose.yml run --rm seed-identity link alice
```

**Mallory is the point.** Pocket ID vouches for her; Mica turns her away because
her subject is not on the list it was given. Authentication and admission are
separate questions, and this is where you can watch that be true.

**Where the list lives is the other point.** It is one environment variable
written by the seed script — Mica has no user table, no invitation and no
People screen. The list is keyed by `issuer|subject` rather than by email
because a person can change their address, and admitting an address
means admitting whoever holds it next.

Alice and bob are indistinguishable, on purpose: everybody admitted is an
editor of this site, and Mica has no roles because it has no accounts to hang
them on. (Alice is also an administrator at Pocket ID, so that she can open its
settings. That has no meaning for Mica.)

The settings of Pocket ID are at <http://localhost:1411>, when you are signed
in as alice, if you want to see what was registered.

---

## A walkthrough worth doing once

1. **Sign in as alice.** Open her link from the log of `seed-identity`, then
   open the editor. Mica sends you to Pocket ID, you come back with a session.
   Mica never saw a credential.

2. **Open System and read _Who may edit_.** That is the whole of authorization:
   two subjects, from configuration. There is no People screen to open.

3. **Sign out, sign in as bob.** Open his link in a private window. He gets in
   without anybody inviting him, because the seed script put his subject on the
   list.

4. **Edit an entry, save, and publish it on the Publish page.** A save alone is
   a draft in Mica's clone; the repository does not move. After Publish, look
   at your repository:

   ```bash
   git -C /path/to/your/repo pull && git log -1 --stat
   ```

   One commit, authored by the editor, touching only files in the content
   root. That is the whole architecture in one command.

5. **Try mallory.** Open her link in a private window and read the message. To
   let her in, add her subject to `MICA_ADMIT_SUBJECTS` — you can read it in the
   address of her page under Users in the settings of Pocket ID — and restart the
   container.

6. **Take alice off the list while she is signed in**, and restart. Her next
   request is refused at once: the rules are re-read on every request rather
   than copied into the session at sign-in.

   A group removed at the *provider* is slower, because Mica only sees the
   claims it was given and learns better at the next sign-in. That is the
   accepted cost of having no user table, and it is why sessions last hours
   rather than weeks — see
   [decision record 3](../../docs/adr/0003-admission-by-provider-claims.md).

---

## Two things about the setup

**Why the CMS shares Pocket ID's network namespace.** Mica and your browser must
reach the issuer at the _same_ URL, or the `iss` claim in the ID token will not
match what discovery returned and the token is rejected. `network_mode:
service:pocket-id` makes `localhost:1411` mean the same thing in both places. It
is also why both ports are published on the `pocket-id` service.

**Why plain HTTP works here.** Mica allows plain-HTTP OIDC discovery only for
a provider on this machine, because an ID token over http to another host is
one anybody on the path can read. `localhost:1411` is this machine, so the rig
needs no certificate. What is under test is the self-hosted composition: a
real provider, a real clone, and a real admission check.

---

## Cleaning up

```bash
docker compose -f deploy/demo-identity/compose.yml down -v
```

`-v` drops the volumes: the data file of Pocket ID, Mica's clone with any drafts
that were not published, and the generated client secret. Your content
repository is untouched — anything an editor published is a commit in it, and
stays there.

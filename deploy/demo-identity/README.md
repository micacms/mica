# The demo stack

Mica in its deployed shape, on your machine: the CMS from its image, a real
identity provider, and a real repository on github.com or gitlab.com.

```bash
cp deploy/demo-identity/.env.example deploy/demo-identity/.env   # your repository and its token
docker compose -f deploy/demo-identity/compose.yml up --build
```

Then open <http://localhost:6422/admin/> and sign in as `alice` /
`Alice-Demo1`.

Two containers and a database, which is what self-hosting Mica costs:

| Service | What it is |
| --- | --- |
| `mica` | Mica itself: one Node process, one SQLite file |
| `zitadel` + `db` | The identity provider |
| `prepare`, `seed-identity` | One-shot jobs. They exit and stay exited |

Your content repository is the third part, and it is deliberately not in here.
Mica commits to a repository you already own, and your website is built from
that repository by CI that never contacts Mica.

> Deliberately local: plain HTTP, passwords in the Compose file, a master key
> anybody can read. It is a demo, not an example deployment. The reference
> deployment is [deploy/self-hosted/compose.yml](../self-hosted/compose.yml) —
> see [docs/self-hosting.md](../../docs/self-hosting.md).

---

## What starts by itself

Nothing has to be clicked. ZITADEL generates its own client credentials on
first boot, so [`seed/seed-identity.sh`](seed/seed-identity.sh) registers Mica
as an OIDC application over ZITADEL's API and leaves the client id and secret
in a volume the CMS reads at start. The same script creates three people:

| Sign in as | Password | What happens |
| --- | --- | --- |
| `alice` | `Alice-Demo1` | Admitted: her subject is in `MICA_ADMIT_SUBJECTS` |
| `bob` | `Bob-Demo1` | Admitted the same way, and with exactly the same powers |
| `mallory` | `Mallory-Demo1` | Authenticates perfectly, and is refused |

**Mallory is the point.** ZITADEL vouches for her; Mica turns her away because
her subject is not on the list it was given. Authentication and admission are
separate questions, and this is where you can watch that be true.

**Where the list lives is the other point.** It is one environment variable
written by the seed script — Mica has no user table, no invitation and no
People screen. The list is keyed by `issuer|subject` rather than by email
because ZITADEL lets a person change their address, and admitting an address
means admitting whoever holds it next.

Alice and bob are indistinguishable, on purpose: everybody admitted is an
editor of this site, and Mica has no roles because it has no accounts to hang
them on.

ZITADEL's own console is at <http://localhost:8080>, as `admin` /
`Admin-Demo1`, if you want to see what was registered.

---

## A walkthrough worth doing once

1. **Sign in as alice.** You are redirected to ZITADEL, sign in there, and come
   back with a session. Mica never saw a password.

2. **Open System and read _Who may edit_.** That is the whole of authorization:
   two subjects, from configuration. There is no People screen to open.

3. **Sign out, sign in as bob.** He gets in without anybody inviting him,
   because the seed script put his subject on the list.

4. **Edit an entry and save.** Then look at your repository:

   ```bash
   git -C /path/to/your/repo pull && git log -1 --stat
   ```

   One commit, authored by the editor, touching only files under
   `REPOSITORY_ROOT`. That is the whole architecture in one command.

5. **Try mallory.** Read the message. To let her in, add her subject to
   `MICA_ADMIT_SUBJECTS` — you can read it from the ZITADEL console — and
   restart the container.

6. **Take alice off the list while she is signed in**, and restart. Her next
   request is refused at once: the rules are re-read on every request rather
   than copied into the session at sign-in.

   A group removed at the *provider* is slower, because Mica only sees the
   claims it was given and learns better at the next sign-in. That is the
   accepted cost of having no user table, and it is why sessions last hours
   rather than weeks — see the P1 entry in
   [`decisions.md`](../../docs/decisions.md).

---

## Two things about the setup

**Why the CMS shares ZITADEL's network namespace.** Mica and your browser must
reach the issuer at the _same_ URL, or the `iss` claim in the ID token will not
match what discovery returned and the token is rejected. `network_mode:
service:zitadel` makes `localhost:8080` mean the same thing in both places. It
is also why both ports are published on the `zitadel` service.

**Why `NODE_ENV=development`.** Mica refuses plain-HTTP OIDC discovery when
`NODE_ENV=production` — correctly, since an ID token over http is one anybody
on the path can read. Giving ZITADEL a certificate is more machinery than a
local rig deserves, so the rig relaxes that one flag. What is under test is
the self-hosted composition: a real provider, a real connector, and a real
admission check.

---

## Cleaning up

```bash
docker compose -f deploy/demo-identity/compose.yml down -v
```

`-v` drops the volumes: ZITADEL's database, Mica's SQLite file, and
the generated credentials. Your content repository is untouched — anything an
editor saved is a commit in it, and stays there.

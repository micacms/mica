# Mica Editor

> **Experimental.** Pre-1.0: the CLI, the API and the content format can still
> change without notice. Use it at your own risk.

The local Mica editor: `@micacms/runtime` and `@micacms/editor-ui` composed for
a developer's own machine. No authentication, no user, no database — the
content directory is the only thing this process writes, and loopback plus a
Host allowlist are what make that safe.

```
localhost:6422
       │
       ▼
      Hono ── /api/*   /admin/*   /health
       │                  │
   connector           Vue SPA (from @micacms/editor-ui)
       │
 your working tree  ←— the draft workspace
```

## Running it against a project

```bash
npx @micacms/editor --content ./content
```

The published package carries the API and the built admin, so this is one
command and no clone. It binds to **loopback** and refuses anything else,
answers only to `localhost` / `127.0.0.1` / `[::1]` — any other Host gets a 403
pointing at the self-hosted distribution — and prints a banner instead of
startup log lines before opening a browser on the editor.

There is no sign-in, because there is nothing to sign in to: no identity
provider, no account, no session, and no `@micacms/auth-oidc` anywhere in the
dependency graph — a boundary test walks the graph to keep it that way. There
is no database either: a save is a file in your working tree, which your
site's dev server hot-reloads, and Publish turns the reviewed changes into one
commit pushed with your own Git configuration (`MICA_LOCAL_PUBLISH=false`
keeps Publish out of the editor entirely).

## Working on Mica itself

```bash
rush update
rush build --to tag:packages

cd apps/local-editor
cp .env.example .env

rush dev                               # API on :6422, admin on :5173
```

`CONTENT_ROOT=../../examples/muster-consulting/content` is the default, so the
server edits the example project's content. There is nothing to seed: the
content is already there, in Git.

The server has no content model of its own. It reads one from the content
directory at `.mica/schema.json`, which the Astro project publishes and the
developer commits. If it is not there, the server says so and exits.

Then open <http://localhost:5173/admin/>. The editor opens directly — no name,
no avatar and no account menu, because there is nothing behind them.

`rush dev` runs this app and the Vite dev server together. Vite
proxies `/api` to the API; the API still needs
`ADMIN_ORIGINS=http://localhost:5173` for its Origin check, which
`.env.example` already sets.

## What lives where

```
src/
├── cli.ts        the `mica` bin: flags, checks, environment, hand-off
├── index.ts      the composition: local connector + runtime + editor UI
├── config.ts     the local slice of the environment, and the refusals
├── guards.ts     the Host allowlist
└── banner.ts     what a person sees instead of log lines
```

Everything of substance is elsewhere: the API and services in
`@micacms/runtime`, the SPA in `@micacms/editor-ui`, the content rules in
`@micacms/core` and `@micacms/connectors`. This package is the composition the
architecture calls `apps/local-editor`, published under the name the command
deserves.

A deployment other people can reach is the other composition:
`@micacms/self-hosted`, with an OIDC provider in front — see
[docs/self-hosting.md](../../docs/self-hosting.md).

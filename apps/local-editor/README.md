# Mica Editor

> **Public.** From 1.0, semver covers the `mica` CLI (`init`, `check` and the
> editor's flags). Pre-1.0: it can still change in a minor release.

The local Mica editor: `@micacms/runtime` and `@micacms/editor-ui` composed for
a developer's own machine. No authentication, no user, no database — the
content directory is the only thing this process writes, and loopback plus a
Host allowlist are what make that safe.

```
localhost:6422
       │
       ▼
      Hono ── /api/*   /admin/*   /health   /ready
       │                  │
   content files       Vue SPA (from @micacms/editor-ui)
       │
 your working tree  ←— the draft workspace
```

## Running it against a project

```bash
npm install --save-dev @micacms/editor
npx mica start ./content
npx mica start --preview   # also the project's astro dev, for the live preview
```

The published package carries the API and the built admin, so this is one
command and no clone. Before it is installed, `npx @micacms/editor start` does
the same. It binds to **loopback** and refuses anything else,
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

## Agents

A coding agent can edit the content too, with the same rules as the editor:
`npx mica start` serves the tools at `http://localhost:6422/mcp`, and
`npx mica mcp` serves them over stdio, for an agent that starts Mica itself.
An agent saves drafts; `MICA_MCP_PUBLISH=true` or `mica mcp --allow-publish`
also gives it `publish`. See [Edit with an agent](https://micacms.com/docs/agents/).

## More commands

```bash
npx mica init     # add Mica to the Astro project in this directory
npx mica check    # check every entry against the model
npx mica import   # move Astro collections into Mica
npx mica mcp      # serve the tools to a coding agent, over stdio
```

`init` writes a starter `src/mica.ts` and `src/content.config.ts`, and never
overwrites a file. It also names the `mica` and `check` scripts that
`package.json` does not have yet. `check` reads every entry the way Mica and the
website read it, and reports what they would skip or refuse: fields that do
not validate, missing media, relations to entries that do not exist, slug
values in a file that differ from its name (Mica uses the name), and files
that are not read at all. It
exits with 1 on an error and with 78 without a readable model, so it fits in
CI. `import` moves Astro content collections into Mica from Astro's data
store. Each command takes only its own options, and a path without an option
is always the content root: `npx mica --help` lists them.

## Working on Mica itself

```bash
rush update
rush build --to tag:packages

rush dev                               # API on :6422, admin on :5173
```

`rush dev` reads `dev.env`, which sets
`MICA_CONTENT_ROOT=../../examples/company-site/content`, so the server edits
the example project's content. There is nothing to seed: the
content is already there, in Git.

The server has no content model of its own. It reads one from the content
directory at `.mica/schema.json`, which the Astro project publishes and the
developer commits. If it is not there, the server says so and exits.

Then open <http://localhost:5173/admin/>. The editor opens directly — no name,
no avatar and no account menu, because there is nothing behind them.

`rush dev` runs this app and the Vite dev server together. Vite
proxies `/api` to the API; the API still needs
`MICA_ADMIN_ORIGINS=http://localhost:5173` for its Origin check, which
`dev.env` sets. The published editor reads no `.env` file: the project's `.env`
belongs to the site. Every variable is at
<https://micacms.com/docs/configuration/>.

## What lives where

```
src/
├── cli.ts        the `mica` bin: flags, checks, environment, hand-off
├── init.ts       `mica init`: the starter files
├── check.ts      `mica check`: every entry against the model
├── index.ts      the composition: developer policy + runtime + editor UI
├── developer.ts  the developer policy: Publish commits and pushes with your own Git
├── config.ts     the local slice of the environment, and the refusals
├── guards.ts     the Host allowlist
├── banner.ts     what a person sees instead of log lines
└── astro-dev.ts  `--preview`: the project's `astro dev` beside the editor
```

Everything of substance is elsewhere: the API and services in
`@micacms/runtime`, the SPA in `@micacms/editor-ui`, the content rules in
`@micacms/core`. This package is the composition the
architecture calls `apps/local-editor`, published under the name the command
deserves.

A deployment other people can reach is the other composition:
`@micacms/self-hosted`, with an OIDC provider in front — see
[docs/self-hosting.md](../../docs/self-hosting.md).

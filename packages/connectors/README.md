# @micacms/connectors

> **Experimental.** Pre-1.0: the API can still change without notice. Use it
> at your own risk.

Repository access for Mica: one narrow interface, with a working-tree
implementation and two that commit through a provider's API.

A connector reads and writes content in a Git repository. That is the whole
surface — there is no clone to keep in sync, no deploy key on disk, and no
content database anywhere behind it.

```ts
import { githubConnector, localConnector } from "@micacms/connectors";

const repo = githubConnector({
  owner: "acme",
  repo: "website",
  token: process.env.REPOSITORY_TOKEN,
  branch: "main",              // defaults to main
  root: "content",             // the token reaches nothing outside this
});

// …or, for a checkout on this machine:
const local = localConnector({ root: "./content" });
```

`gitlabConnector` is the same, with one `project` — `group/project`, or the
numeric id — in place of `owner` and `repo`.

## What a connector guarantees

- **One save is one commit**, however many files the save touches — an
  `index.json`, its `.mdoc` sidecars and its media go in together or not at all.
- **Concurrent edits are caught, not merged.** Each path carries an opaque
  revision token; a write against a stale one is refused.
- **A tree it cannot list completely is refused**, rather than partly deleted.
  GitHub truncates a large tree listing, and under-deleting silently is worse
  than failing loudly.
- **It stays inside `root`.** Paths are checked, not trusted.

## Install

```bash
npm install @micacms/connectors
```

Requires Node 22.12 or newer. Licence: MIT.

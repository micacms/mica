# Getting started

> **Experimental.** Mica is pre-1.0 and its APIs, CLI and content format can
> still change without notice. Try it, but do not depend on it for anything
> you cannot afford to redo. Use it at your own risk.

Add Mica to an Astro project and edit its content locally. Five minutes.

---

## The short version

Four commands and one file. Sections 1–5 are the same thing, slowly.

```bash
npm install @micacms/astro @micacms/model
# write src/mica.ts and src/content.config.ts — see step 2 and step 3
npx astro build          # publishes the model to content/.mica/schema.json
npx @micacms/cms         # opens the editor
```

The last command prints one address and opens your browser on it. There is no
account to create, no password to type and no sign-in screen: on your own
machine Mica opens straight into the editor.

---

## The three pieces

| | What it is | Where it lives |
| --- | --- | --- |
| **Your repository** | Entries as JSON and Markdoc, images beside them | GitHub, GitLab, or a checkout |
| **Mica** | One Node process; a SQLite file of accounts and sessions | Your machine now, a server later |
| **Your website** | Static files from `astro build` | Any static host |

Mica is not where your content lives. Turn it off, lose its disk, throw it
away: the website is unaffected, because it is in Git in a format a text editor
can read.

## Before you start

- **Node 22.5 or newer** — `node --version`
- **An Astro 5 project.** A new one (`npm create astro@latest`) or one you
  already have. Mica edits content; it does not touch your templates.

---

## 1. Install the packages

```bash
npm install @micacms/astro @micacms/model
```

`@micacms/model` is the field DSL. `@micacms/astro` turns a model into Astro
collections and publishes it for Mica to read.

## 2. Define the content model

A plain module. It imports nothing from Astro, so anything can read it — and it
keeps the collections file short:

```ts
// src/mica.ts
import { collection, date, defineSite, media, richText, singleton, slug, text } from "@micacms/model";

export const site = defineSite({
  // Relative to the Astro project root, like Astro's own `glob({ base })`.
  root: "./content",

  collections: {
    news: collection({
      label: "News",
      labelSingular: "Article",
      fields: {
        title: text({ label: "Title", required: true, maxLength: 120, listed: true }),
        slug: slug({ from: "title" }),
        publishedOn: date({ label: "Published on", listed: true }),
        cover: media({ accept: "image" }),
        body: richText(),
      },
    }),
  },
  singletons: {
    settings: singleton({
      label: "Website",
      fields: {
        siteName: text({ label: "Site name", required: true }),
        tagline: text({ label: "Tagline" }),
      },
    }),
  },
});
```

Every field type is in [content-model.md](./content-model.md).

## 3. Turn it into collections

```ts
// src/content.config.ts
import { micaCollections } from "@micacms/astro";

import { site } from "./mica";

export const collections = micaCollections(site);
```

That is the whole wiring. **`astro.config` gets nothing** — the loaders do the
rest, because Astro hands them the project root and, in dev, its file watcher:
they read the content, publish the model for Mica, and reload when an entry is
saved.

Your own collections go in the same export, and Mica leaves them alone:

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/docs" }),
  schema: z.object({ title: z.string() }),
});

export const collections = { ...micaCollections(site), docs };
```

## 4. Publish the model

```bash
npx astro build          # or start the dev server once
git add content/.mica/schema.json
git commit -m "Publish the content model"
```

That file is how Mica learns what your project defines. It is generated, and it
is committed anyway: Mica reads it out of the repository it is already
connected to, so there is nothing to mount and no second channel to keep in
step. Any build or dev-server start rewrites it, so the habit is only to commit
it after a model change.

## 5. Run Mica against it

```bash
npx @micacms/cms
```

That is the whole local setup:

```
  ◆ Mica 0.0.4

  Editor     http://localhost:6422/admin/
  Content    ./content — 1 collection and 1 singleton
  Saving     writes files into that directory. Commit them like any other change.
```

It reads `./content`, serves the editor on
<http://localhost:6422/admin/>, opens your browser on it, and binds to loopback
only. Point it somewhere else with `npx @micacms/cms ./site/content`, keep the
browser shut with `--no-open`, and see `--help` for the rest. The port is
Mica's own — nothing else you are likely to be running wants 6422, so it does
not collide with `astro dev` beside it.

**There is no sign-in.** Not a skipped one: local mode has no identity provider,
so there is nothing to ask and nobody to ask it of, and opening the editor is
the whole of it. Every request is one developer account with administrator
rights — which is why Mica refuses to start this way in production, or on any
host but this one, and why a Mica other people reach is a container with an
identity provider in front of it.

Nothing is written into your repository. Accounts and sessions go to a cache
directory outside the project, because in local mode there is one implicit
developer and nothing worth keeping; the command prints the path.

## 6. Edit something, and look at the result

Create an entry, fill in the form, press Save. Then:

```bash
git status
git diff
```

```
content/news/we-are-hiring/
├── index.json          the fields
├── body.mdoc           rich text, one file per field
└── media/
    └── office.jpg
```

That is the whole idea. Commit it with your normal tools; in a deployed setup
Mica does the committing itself, and the files are identical either way.

## 7. Render it

Ordinary Astro. Nothing here knows a CMS exists:

```astro
---
import { getCollection } from "astro:content";
const news = await getCollection("news");
---

{news.map((article) => <h2>{article.data.title}</h2>)}
```

`article.data` is typed from the model, so a renamed field is a build error
rather than an empty page. Rich text arrives rendered:

```astro
---
import { renderRichText } from "@micacms/astro";
const html = renderRichText(article.data.body);
---
<article set:html={html} />
```

Run `astro dev` beside Mica and a save in one reloads the other.

---

## What changes when you deploy

Nothing about the model or the content. Mica moves to a server, authenticates
with an OIDC provider instead of nobody, and commits through GitHub's or
GitLab's API instead of writing to a checkout. Your build stays a `git push`
away from a static host. See [self-hosting.md](./self-hosting.md).

---

## When something is wrong

**"There is no content model at …/.mica/schema.json".**
Step 4 was skipped, or the file was never committed to the branch Mica reads.

**"Port 6422 is already in use".**
Another Mica, almost certainly. Stop it, or run this one on
`npx @micacms/cms --port 6423`.

**The admin shows collections you removed, or is missing one you added.**
The model in the repository is stale: re-run the build, commit, restart Mica.

**Saving returns 409.**
Someone else changed that entry, or a push landed while the editor was working.
Nothing is lost — the changes are still in the form, and the message offers to
load the current version.

**Saving returns 422.**
The entry does not satisfy the model. The response names the offending fields
and the admin puts the messages next to them.

**Adding a required field made existing entries invalid.**
Correct, and the website build is where you find out — better a red build than
a quietly empty page. Edit the entries, or make the field optional.

---

To try everything without touching a project of your own,
`examples/muster-consulting` is a complete site — model, content and
templates — and `pnpm dev` from a clone edits it by default.

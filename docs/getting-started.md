# Getting started

> **Experimental.** Mica is pre-1.0. Its API, CLI and content format can change
> without notice. Use it for work you can update as the project changes.

Add Mica to an Astro project and edit its content on your machine. Five minutes.

## Before you start

- Node 22.12 or newer — `node --version`
- An Astro 6 or 7 project — a new one (`npm create astro@latest`) or one you have
- A Git repository for that project

## The short version

```bash
npm install @micacms/astro @micacms/model
# write src/mica.ts and src/content.config.ts — steps 2 and 3
npx astro build          # writes content/.mica/schema.json
npx @micacms/cms         # opens the editor
```

The steps below are the same four commands, with the two files written out.

---

## 1. Install the packages

```bash
npm install @micacms/astro @micacms/model
```

`@micacms/model` defines fields. `@micacms/astro` turns a model into Astro
collections and publishes it for Mica.

## 2. Define the content model

Write `src/mica.ts`. The model is plain TypeScript and imports nothing from
Astro:

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

Write `src/content.config.ts`:

```ts
// src/content.config.ts
import { micaCollections } from "@micacms/astro";

import { site } from "./mica";

export const collections = micaCollections(site);
```

`astro.config` stays as it is. The loaders read the content, publish the model,
and reload the dev server when an entry is saved.

Keep your own collections in the same export:

```ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/docs" }),
  schema: z.object({ title: z.string() }),
});

export const collections = { ...micaCollections(site), docs };
```

Mica edits the collections it declares and ignores the rest.

## 4. Publish the model

```bash
npx astro build          # or start the dev server once
git add content/.mica/schema.json
git commit -m "Publish the content model"
```

`schema.json` tells Mica what your project defines. Mica reads it from the
repository, so commit it after each model change. Every build rewrites it.

## 5. Run Mica

```bash
npx @micacms/cms
```

```
  ◆ Mica 0.0.4

  Editor     http://localhost:6422/admin/
  Content    ./content — 1 collection and 1 singleton
  Saving     writes files into that directory. Commit them like any other change.
```

The command reads `./content`, listens on loopback, and opens your browser on
the editor. Give it a different content root with
`npx @micacms/cms ./site/content`, keep the browser shut with `--no-open`, and
see `--help` for the rest. Port 6422 is Mica's own, so `astro dev` can run
beside it.

The editor opens directly: on your machine Mica runs without an identity
provider, and every request is one developer account with administrator rights.
Mica refuses to start this way in production or on any host but this one. To let
other people in, deploy it — see [self-hosting.md](./self-hosting.md).

Accounts and sessions go to a cache directory outside your project. The command
prints the path.

## 6. Save an entry, and read the diff

Create an entry, fill in the form, and press Save. Then:

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

Commit it with your usual tools. A deployed Mica writes the same files and
commits them itself.

## 7. Render it

```astro
---
import { getCollection } from "astro:content";
const news = await getCollection("news");
---

{news.map((article) => <h2>{article.data.title}</h2>)}
```

`article.data` is typed from the model, so a renamed field fails the build.
Rich text arrives rendered:

```astro
---
import { renderRichText } from "@micacms/astro";
const html = renderRichText(article.data.body);
---
<article set:html={html} />
```

Run `astro dev` beside Mica. A save in one reloads the other.

---

## The three pieces

| | What it is | Where it lives |
| --- | --- | --- |
| **Your repository** | Entries as JSON and Markdoc, images beside them | GitHub, GitLab, or a checkout |
| **Mica** | One Node process; a SQLite file of accounts and sessions | Your machine now, a server later |
| **Your website** | Static files from `astro build` | Any static host |

Your content stays in the repository, in formats Git and a text editor can
read. The website builds from those files, with or without Mica running.

## What changes when you deploy

The model and the content stay as they are. Mica moves to a server,
authenticates with an OIDC provider, and commits through the GitHub or GitLab
API instead of writing to a checkout. Your build stays a `git push` away from a
static host. See [self-hosting.md](./self-hosting.md).

## When something is wrong

**"There is no content model at …/.mica/schema.json".**
Run step 4, and commit the file to the branch Mica reads.

**"Port 6422 is already in use".**
Another Mica, most likely. Stop it, or run `npx @micacms/cms --port 6423`.

**The admin shows collections you removed, or misses one you added.**
The model in the repository is stale. Re-run the build, commit, and restart
Mica.

**Saving returns 409.**
Someone else changed that entry, or a push landed while the editor was open.
Your changes stay in the form, and the message offers to load the current
version.

**Saving returns 422.**
The entry does not satisfy the model. The response names the fields, and the
admin shows each message next to its input.

**A new required field made existing entries invalid.**
The website build reports it. Edit those entries, or make the field optional.

---

`examples/muster-consulting` is a complete site — model, content and templates.
`pnpm dev` from a clone edits it.

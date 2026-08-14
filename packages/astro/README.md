# @micacms/astro

Reads a Mica content repository as Astro Content Collections, through the
Content Layer API.

The build needs no CMS running, no URL and no token. Content is files in the
checkout the build is already in, so the website cannot be broken by the CMS
being down, slow, or mid-deploy.

```ts
// src/content.config.ts
import { micaCollections } from "@micacms/astro";
import site from "../../mica.config";

export const collections = micaCollections(site, { root: "../../content" });
```

```ts
// astro.config.mjs
import { mica } from "@micacms/astro";
import site from "./mica.config.ts";

export default defineConfig({
  integrations: [mica({ site, root: "./content" })],
});
```

Pages then use ordinary Astro:

```astro
---
import { getCollection } from "astro:content";
const news = await getCollection("news");
---
```

`getCollection("news")` is fully typed from the model, with no code generation
step — so renaming a field breaks the build rather than the page.

## The two exports

- **`micaCollections(site, options)`** builds one loader and one Zod schema per
  collection and singleton. Rich text arrives rendered from Markdoc; each
  document carries a `_mica` field with what the model knows about it.
- **`mica({ site, root })`** is the dev-server integration. It makes `astro dev`
  notice content edits — Astro's own watcher does not reach them, because no
  page imports a content file — and writes the protocol manifest into the build
  output.

## Install

```bash
npm install @micacms/astro
```

Astro 5 is a peer dependency. Requires Node 22.5 or newer. Licence: MIT.

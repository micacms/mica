# Muster Consulting

An example website for a fictional consultancy: a complete Mica project with a
content model, real content, and Astro templates that render it.

It is here to be read and copied, not depended on. The design is the part that
should differ between projects; the loader, the model and the CMS are the parts
that should not.

```bash
pnpm --filter @micacms/example-muster-consulting dev    # or: pnpm dev:site
```

<http://localhost:4321>. To edit the content, run Mica beside it — `pnpm dev`
from the repository root points at this project's `content/` by default.

---

## What to look at

| | |
| --- | --- |
| `src/mica.ts` | The whole content model: four collections, three singletons |
| `src/content.config.ts` | Six lines: the model becomes collections, beside one Mica does not own |
| `src/glossary/` | Markdown for that other collection — the developers' to maintain |
| `content/` | The entries themselves — JSON, Markdoc and images |
| `content/.mica/schema.json` | The model, published by the build for Mica to read |
| `astro.config.mjs` | Note what is *not* in it: nothing of Mica |
| `src/lib/content.ts` | Typed helpers over the generated collections |
| `src/lib/images.ts` | Turning a media reference into a build-time asset |
| `src/components/RichText.astro` | Rendering a Markdoc field |

## The model, in one line each

- **pages** — standalone pages (About, Services, Contact) with a rich-text body
- **projects** — reference work, with a gallery and a location
- **news** — articles, with a cover image
- **team** — people, a flat collection with no rich text, so one file each
- **site**, **navigation**, **theme** — singletons for settings, menus and
  colours

The theme singleton is worth a look: the editor picks a primary colour and a
typeface, and the layout turns those into CSS custom properties. It is a small
demonstration of the model reaching further than text.

**glossary** is the odd one out, and deliberately so: an ordinary Astro
collection of Markdown files, defined beside the Mica ones. It renders at
`/glossary` through the same `getCollection` every other page uses, and it never
appears in the CMS — because not everything on a website is the client's to
edit.

## Making it yours

Copy the directory, keep `src/mica.ts` and `content/` as a starting shape, and
replace everything under `src/pages`, `src/layouts` and `src/components`. Then
run the build once to republish the model, and commit
`content/.mica/schema.json`.

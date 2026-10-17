# Harbor Lane Consulting

An example website for a fictional company: an independent consultancy for
growing companies. It is a complete Mica project with a content model, content
and Astro templates that render it. It uses every field kind and every editor
feature of Mica, so you can see what Mica does.

It is here to be read and copied, not depended on. The design is the part that
should differ between projects; the loader, the model and the CMS are the parts
that should not.

All names, places and addresses are made up. The domain `harborlane.example`
does not exist.

The photos were made with the built-in OpenAI image model. They show fictional
people and work scenes. See [IMAGES.md](./IMAGES.md) for the image paths and
prompts. Images are local files; Astro processes them during the build.

The team page shows five fictional people and Bento, the company dachshund.
Bento is last in the saved team order.

The Contact page uses a generated city map of Porto Celeste, Valdoria, with
street and district labels. It has no title and shows the wider harbour area.
Its street plan is fictional. The map and directions use the page's extra
sections.

## Run it

```bash
cd examples/company-site && rushx dev
```

Open <http://localhost:4321>. To edit the content, run Mica beside it:

```bash
rushx mica        # the editor, on http://localhost:3000
```

`rush dev` from the repository root also starts the editor with this project's
`content/` by default. Outside this repository, use `npx mica start` in the
project directory.

To check the content without a browser, run `rushx check`. It runs
`mica check` and `astro check`.

## What to look at

| File                        | Content                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `src/mica.ts`               | The whole content model: five collections, three singletons, one reference set |
| `src/content.config.ts`     | The model becomes collections, beside one that Mica does not own               |
| `src/glossary/`             | Markdown for that other collection, which the developers maintain              |
| `src/reference/sectors.json`     | Reference data: the NACE sections, which a project's sector points to          |
| `content/`                  | The entries: JSON, Markdoc and images                                          |
| `content/.mica/schema.json` | The model, published by the build for Mica to read                             |
| `content/.mica/references/` | The index of the reference data, also published by the build                   |
| `src/lib/content.ts`        | Typed helpers over the collections, and the relations seen from the other side |
| `src/lib/images.ts`         | An absolute URL of an image, for the social-sharing meta tags                  |

## The model in one line each

- **pages**: standalone pages (About us, Services, Contact, Legal notice)
- **projects**: client work, with a gallery, a location, a team, a sector, downloads and tags
- **news**: articles with an author, a related project and tags
- **events**: workshops and talks with a time, a venue on a map, speakers and tags
- **team**: people with a portrait
- **site**, **navigation**, **theme**: singletons for settings, menus and colours

**glossary** is an ordinary Astro collection of Markdown files. It is defined
beside the Mica collections and it renders at `/glossary`. It never appears in
the editor, because not everything on a website is for the editor to change.

## Feature to where it is used

Paths are in `src/mica.ts` (the model) and `content/` (an example entry), unless
the file name says otherwise.

### Field kinds

| Feature                                                  | Model                                                        | Example content                                             | Page that shows it                 |
| -------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------- |
| `text` with `pattern` and `patternMessage`               | `projects.code`, `team.phone`                                | `projects/*/index.json`                                     | `src/pages/projects/[slug].astro`  |
| `textarea`                                               | `news.excerpt`, `events.summary`                             | `news/*/index.json`                                         | `src/pages/news/index.astro`       |
| `richText` (Markdoc)                                     | `pages.body`, `projects.description`, `events.body`          | `pages/about-us/body.mdoc`                                  | `src/components/RichText.astro`    |
| `number` with `unit`                                     | `projects.duration` (weeks), `events.capacity` (seats)       | `projects/*/index.json`                                     | `src/pages/projects/[slug].astro`  |
| `boolean`                                                | `projects.featured`, `team.featured`                         | `projects/*/index.json`                                     | `src/pages/index.astro`            |
| `date`                                                   | `news.publishDate`                                           | `news/*/index.json`                                         | `src/pages/news/[slug].astro`      |
| `date` with `includeTime`                                | `events.startsAt`, `events.endsAt`                           | `events/*/index.json`                                       | `src/pages/events/[slug].astro`    |
| `email`                                                  | `team.email`, `site.email`                                   | `team/*/index.json`                                         | `src/pages/team/[slug].astro`      |
| `url`                                                    | `events.registrationUrl`, `site.social`                      | `events/*/index.json`                                       | `src/pages/events/[slug].astro`    |
| `slug`                                                   | every collection                                             | the folder name of each entry                               | all `[slug].astro` pages           |
| `select`                                                 | `projects.category`                                          | `projects/*/index.json`                                     | `src/components/ProjectCard.astro` |
| `select` with `multiple`                                 | `events.format`                                              | `events/*/index.json`                                       | `src/pages/events/[slug].astro`    |
| `object`                                                 | `projects.location`, `events.venue`, `pages.seo`             | `projects/*/index.json`                                     | `src/pages/projects/[slug].astro`  |
| `repeater`                                               | `projects.facts`, `pages.sections`, `navigation.main`        | `pages/services/index.json`                                 | `src/pages/[...slug].astro`        |
| `relation`                                               | `news.author`, `news.relatedProject`                         | `news/*/index.json`                                         | `src/pages/news/[slug].astro`      |
| `relation` with `multiple`                               | `projects.team`, `events.speakers`                           | `events/*/index.json`                                       | `src/pages/events/[slug].astro`    |
| `media` with `alt: "required"`                           | `news.coverImage`, `team.portrait`                           | `news/we-are-hiring-a-junior-consultant/index.json`         | `src/pages/news/[slug].astro`      |
| `media` with `multiple` (gallery)                        | `projects.gallery`                                           | `projects/erp-selection-for-a-regional-retailer/index.json` | `src/pages/projects/[slug].astro`  |
| `color`                                                  | `theme.primaryColor`, `theme.accentColor`                    | `theme/index.json`                                          | `src/layouts/BaseLayout.astro`     |
| `tags` with `max`, `maxLength`, `suggestions`, `default` | `projects.tags`, `news.tags`, `events.tags` (with `default`) | `events/*/index.json`                                       | `src/components/TagList.astro`     |
| `coordinates` with `map` (stores the zoom too)           | `events.venue.place`                                         | `events/fix-your-order-to-cash-flow-a-half-day-workshop/index.json` | `src/pages/events/[slug].astro` |
| `media` with an `accept` list (files)                    | `projects.downloads` (PDF, ZIP, CSV)                         | `projects/order-to-cash-review/index.json`                  | `src/pages/projects/[slug].astro`, `src/pages/files/[...path].ts` |
| `relation` to a reference set                            | `projects.sector`, to `sectors`                              | `projects/*/index.json`                                     | `src/pages/projects/[slug].astro`  |

### Editor features

| Feature                                  | Where it is used                                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual order (`sortable`, `_order.json`) | `pages` and `team` in `src/mica.ts`; `content/pages/_order.json` and `content/team/_order.json`                                                                   |
| Settings with a media folder             | the `site` singleton: its `logo` media field keeps the file in `content/site/media/`                                                                              |
| A URL that other entries link to         | the `slug` of a project: `content/news/our-2026-sme-operations-benchmark/body.mdoc` links to `/projects/order-to-cash-review/`                                    |
| A read-only field                        | `projects.code` (Project number) in `src/mica.ts`                                                                                                                 |
| Groups and widths                        | `site` (group "Contact"), `events.venue` (group "Where"), `width: "half"` on many fields                                                                          |
| Collapsible objects                      | `pages.seo`, `site.analytics`                                                                                                                                     |
| Tags                                     | `projects.tags`, `news.tags`, `events.tags`; shown with `src/components/TagList.astro`                                                                            |
| Relations from both sides                | forward: `src/pages/events/[slug].astro` uses `relatedAll`; reverse: `src/pages/team/[slug].astro` uses `getProjectsOf` and `getEventsOf` in `src/lib/content.ts` |
| Alt text                                 | every `media` field with `alt: "required"`; the `alt` is passed to `<Image>` in `src/pages/news/[slug].astro`                                                     |
| Astro images                             | `<Image {...coverImage} />` in `src/pages/news/[slug].astro`, and the first gallery image in `src/pages/projects/[slug].astro`                                    |
| Relation helper                          | `related` and `relatedAll` from `@micacms/astro/relations` in the news, project and event pages                                                                   |
| Rich text in a repeater                  | `content/pages/services/sections.0.text.mdoc`                                                                                                                     |
| A collection that Mica does not own      | `src/glossary/`, defined in `src/content.config.ts`                                                                                                               |
| Page addresses (`url`)                   | every collection in `src/mica.ts`: with `MICA_SITE_URL`, an entry shows "Open on website", and the local editor shows "Preview" while `astro dev` runs        |
| Reference data                           | `references.sectors` in `src/mica.ts`, from `src/reference/sectors.json`, which `src/content.config.ts` also reads as the Astro collection `sectors`                  |
| A website component without styles       | `LocationMap` from `@micacms/astro/components` in `src/pages/events/[slug].astro`; it needs `maplibre-gl`                                                        |
| Files for download                       | `mediaFile` from `@micacms/astro` in `src/pages/files/[...path].ts` copies the downloads into the built site                                                      |
| Optimized images in rich text            | `src/components/RichText.astro` passes the entry's data to `renderRichText`, which lets Astro optimize each image                                                |

## Making it yours

Copy the directory, keep `src/mica.ts` and `content/` as a starting shape, and
replace everything under `src/pages`, `src/layouts` and `src/components`. Then
run the build once to publish the model again, and commit
`content/.mica/schema.json`.

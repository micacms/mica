# 23. `@micacms/astro` gives what each website needs

**Status:** Accepted

## Context

Each website wrote the same helpers: a singleton getter with a cast, a sort by the editor's order, an image map, a map component. Each copy had the same defects.

## Decision

- A `media({ accept: "image" })` field reaches Astro as Astro's own `image()`, optimized at build. With `alt`, it is `{ src, alt }`, ready for `<Image {...value} />`. Other files are paths from the content root, and `mediaFile(site, path)` gives the file on disk.
- `getSingleton(site, name)` reads a singleton with the model's types and fails the build while it has no content. `_mica.position` holds the editor's order, and `inEditorOrder` sorts by it. `_mica` holds only `position` and `images`.
- `await renderRichText(text, entry.data)` finds the entry's images and gives each a `srcset` in WebP. `{ optimize: false }` writes the original.
- `@micacms/astro/relations` gives `related` and `relatedAll`. It is a separate entry point, because it imports `astro:content`.
- `@micacms/astro/components` holds Astro components without styles, such as `<LocationMap>`. A library that a component needs, such as `maplibre-gl`, is an optional peer dependency.
- Core stays free of Astro: `fieldsSchema(fields, { image })` takes the image resolver.

## Consequences

- A site that moves from Astro collections keeps its image code.
- `renderRichText` needs Astro's image service (`sharp`).
- A page with a map loads tiles from the tile host. The site's privacy notice names it.
- Change this decision when: Mica supports a second framework. It needs its own helpers.

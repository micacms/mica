# 43. The locale in a page's address, and unique localized IDs

**Status:** Accepted. Adds to [42](0042-localized-fields.md).

## Context

Record 42 gives a field a value for each locale, and the editor shows a form in one locale at a time. The model's `url` gives the page of an entry, such as `/news/{id}`, but not the page of each locale. So the editor's Preview, the live preview and "Open on website" always show the page of the default locale, and a translator does not see the page that they change. A localized `id()`, such as a `slug` for each locale, can also have the same value in two entries: Astro then builds one page for both, and nothing says so.

## Decision

- A `url` can name `{locale}` once, as a whole part of the path: `/{locale}/news/{id}`. Only a site with `locales` can, and a singleton can too: `/{locale}/`.
- The site option `prefixDefaultLocale`, with the name and the default of Astro's `i18n.routing`, says whether the default locale has its prefix. Without it (`false`), `{locale}` and its `/` are not in the address of the default locale: `/{locale}/news/{id}` is `/news/hello` in English and `/de/news/hello` in German.
- The editor fills `{locale}` with the form's language: the Preview, the live preview, "Open on website" and the address under the ID field show the page of that language. A list, a relation picker and the Publish page show the page of the default locale.
- The live preview reads the locale back from the path of its page. When the page in the preview is in another language, the form changes to that language.
- The values of a localized `id()` at the top level of a collection must differ between the entries, in each locale. The value of a locale is the one that the website uses, with its fallback. `mica check` and Publish report a value that another entry has. Publish reads the other entries of such a collection, and only of such a collection.
- A localized field in the address, such as `/{locale}/{slug}`, is not part of this record: the editor reads an entry back from its path by `{id}`.

## Consequences

- An address with `{locale}` needs a site with locales. An older Mica cannot read such a model; it shows no page link for it (`readManifest` leaves the `url` out).
- The site's routes and the model's `url` must agree, as they do without locales: Mica only builds links, and never asks the website.
- Two entries with the same localized `id()` in one locale cannot publish until one of them changes.

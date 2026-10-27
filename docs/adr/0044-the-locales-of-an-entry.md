# 44. The locales of an entry come from its values

**Status:** Accepted. Adds to [42](0042-localized-fields.md).

## Context

With record 42, each entry is in all locales of the site. An article with a German translation but no Swiss German one still gets a Swiss German page, which shows the German text through the fallback. A website cannot tell in which locales an entry has content of its own, so its lists, its sitemap and its `hreflang` links show each entry in each locale. Editors and agents also cannot find the entries that still need a translation, except entry by entry.

## Decision

- Mica stores no list of locales. An entry is in the default locale, and in each other locale where every required localized field, and at least one localized field, has its own value. A fallback value does not count. An entry of a model without localized fields is in every locale.
- `required` still applies to the default locale, so an entry is always in the default locale. Content that exists in one language only goes in a collection for that locale.
- `localesOf(site, name, data)` in `@micacms/astro` gives these locales, for `getStaticPaths`, lists, the sitemap and `hreflang`. The website decides if it uses them: a page of a locale that the entry is not in still works with the fallback.
- A relation to an entry still gives the entry in each locale. A page that links to it can ask `localesOf` and link to another locale.
- A missing translation is a localized value that the default locale has and another locale does not. Mica shows the number of them, and never blocks a save or Publish for them:
  - the editor's list of a collection shows them for each entry, and filters the entries that miss one language; an entry opens in that language;
  - the dashboard lists, for each language, the collections and singletons that miss translations;
  - the MCP tool `list_entries` gives `missingTranslations` for each entry, and its option `missing` lists the entries that miss one locale;
  - `mica check` lists them as information, not as a problem.

## Consequences

- No file changes, and no value can disagree with a list of locales.
- A site that wants a page only where a translation exists marks the main localized field, such as the title, as `required`.
- The dashboard reads every entry of a collection with localized fields. On a large site it is slower than a count of folders.
- An entry that exists only in a locale other than the default is not possible. A later record can change this, with `required` for the locales of an entry.

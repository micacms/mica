# 42. Localized fields: one entry, a value for each locale

**Status:** Accepted. Replaces [22](0022-no-native-multilingual-content.md).

## Context

With the object pattern of record 22, a site in several languages declares an object for each field. The forms are long, and the model cannot tell a translation from an ordinary group. Most CMSes use one of two models: an entry for each locale, linked by a key, or one entry with a value for each locale in a field. In Mica, an entry is one atomic folder, and a relation stores one ID. A field that has a value for each locale keeps both.

## Decision

- The site declares its locales: `locales: ["de", "en"]`, `defaultLocale: "de"`, and optionally `fallback: { fr: "en" }`, with the same names as Astro's `i18n`. A locale code is a JSON key and a part of a file name: letters, digits and hyphens, such as `de` or `en-us`. Two codes must not differ only in case.
- A field option `localized: true` gives the field a value for each locale. `localized: { fallback: false }` keeps a missing value empty. Containers (`object`, `repeater`) and the ID field of a collection cannot be localized, and a localized ID cannot follow another field with `from`. The fields inside a container can be localized.
- Storage is the object pattern of record 22: `{ "de": …, "en": … }` in `index.json`, and `body.de.mdoc` for rich text. `defineSite` expands a localized field into an object with one field for each locale, the default locale first, so validation, serialization, the manifest, the editor and the MCP tools read it as an object. The object keeps `localized`, so that the editor and the website know it.
- `required` and `default` apply to the default locale only. A missing translation never blocks a save or Publish.
- The fallback is resolved when the website reads the content, never written to a file. A missing value takes the value of the next locale in its chain: `fallback`, then `defaultLocale`. A file holds only real translations, and a Git diff shows only them.
- The editor shows a form in one locale at a time, with a switcher. A localized field shows the input of that locale, and a button with its value in the other locales, which marks a missing translation. An empty text input shows its fallback as the placeholder. A field that is the same in each locale shows in each locale.
- The locales that an entry is in come from its values: see [44](0044-the-locales-of-an-entry.md). `{locale}` in a `url` and a check that a localized ID is unique are in [43](0043-locale-in-page-addresses.md).

## Consequences

- A site that uses the object pattern changes each object to a field with `localized: true` without a migration, when the object's keys are its locales.
- All locales of an entry have the same structure, and they publish together. Content that is different in each language uses one collection for each locale.
- An older Mica cannot read a model with locales. Upgrade Mica with `@micacms/astro`.
- A field that has values already changes their shape when it gets `localized`: its values must move into the default locale.
- A title, a list column, a sort and the source of a new ID take the first locale that has a value, the default locale first.
- Without `locales`, the option `localized` is a model error.

# Handover: localized fields (branch `feature/localized-content`)

Delete this file before the merge. It is a note for the next coding agent, not documentation.

## State

- The branch has the ADR, the implementation in core, astro, runtime and the editor, tests, change files and docs.
- `rush build`, `rush typecheck` and `rush test` passed at the last commit.
- No pull request exists yet. Nothing is released.
- The `reviewer` agent reviewed the core and the astro part. All its findings are fixed, except the items under "Open". It did not review the editor switcher (the last commit).

## Design (read first)

- [`docs/adr/0042-localized-fields.md`](docs/adr/0042-localized-fields.md) replaces ADR 22. Section 5.1 of [`docs/content-format.md`](docs/content-format.md) is the storage spec.
- `defineSite` expands a field with `localized` into an `object` with one field for each locale, the default locale first, and with `localized` kept on the object ([`packages/core/src/locale.ts`](packages/core/src/locale.ts), `expandLocalized`). Storage, validation, the manifest, MCP, `mica check` and import then see a plain object. Do not add locale handling to those layers.
- `required` and `default` go to the field of the default locale. A fallback is resolved only on read: `localize()` in core (internal) and `localize(site, name, data, locale)` in `@micacms/astro`. It is never written to a file.
- `singleValue(field, value)` (core) is the one rule for "a localized value as one value": titles, list columns, sort, ID source, row labels.
- Editor: `/api/admin/schema` gives `site.locales` (`list` with the default first, `default`, `fallback`).
  - [`useFormLocale.ts`](packages/editor-ui/src/composables/useFormLocale.ts) provides the chosen language.
  - [`LocaleSwitcher.vue`](packages/editor-ui/src/components/LocaleSwitcher.vue) is above the entry and singleton forms.
  - [`ObjectField.vue`](packages/editor-ui/src/components/fields/ObjectField.vue) shows only the input of the chosen language.
  - [`lib/locales.ts`](packages/editor-ui/src/lib/locales.ts) has the logic that the tests reach.
  - `focusField` sends `reveal-field` with the path as `detail`. The view switches the language, cancels the event, and `focusField` tries again.

## Open

1. The `reviewer` agent reviewed the editor and the example site. Its findings are fixed (field key per locale, `lang` on the value only, visible "!", header scroll padding, focus after Use, legend, Safari, `reveal` guard, tests, no switcher without localized fields). Not checked in a browser: the overlay form beside the live preview.
2. The website comparison pages still say "Mica has no language setting": `sites/micacms/content/compare/index.json` and `sites/micacms/content/comparisons/{decap-cms,sveltia-cms,cloudcannon,pages-cms}`. Suggestion: `site-keeper` changes them at the release.
3. Known gaps for GitHub issues with the label `known-gap` (ask the user first): links in rich text and select option labels are not localized; Preview and "Open on website" open the default locale's page.
4. Later records (ADR 42 names them): the list of the locales that an entry is in; `{locale}` in a collection's `url`; a uniqueness check for a localized `id()`.
5. Delete this file, then open the pull request. Use the structure in AGENTS.md, and say why the API reports (`packages/{core,astro}/api/*.api.md`) change.

## The user's rules for this work

- Before 1.0, backward compatibility is no concern. Breaking changes are acceptable. Do not add compatibility shims.
- Write in ASD-STE100 Simplified Technical English. Commit messages have one line and no co-author line.
- Change the content of `sites/micacms` with the `mica-site` MCP server, after `rush build`. Pages saved through MCP are drafts, which are uncommitted files: commit them.
- Do not commit, push or open a pull request unless the user asks.

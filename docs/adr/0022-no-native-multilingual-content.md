# 22. No native multilingual content in 1.0

**Status:** Accepted

## Context

Two patterns work with the current model and need no code. A later native option must not need a migration.

## Decision

- The model has no locale concept in 1.0. The docs describe two patterns: an object for each field (`title: object({ de, fr, en })`) for pages and singletons, and one collection for each locale for content such as news.
- A later `localized` option will store exactly what the object pattern stores today, `body.de.mdoc` included (`docs/content-format.md`, section 3).

## Consequences

- The editor has no locale switcher, and the object pattern gives long forms.
- A localized URL needs a slug field for each locale, or the collection pattern.
- Revisit when: the forms become too long, or translators must see only their language.

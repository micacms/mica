# 14. Each entry is a folder, and its URL is the folder name

**Status:** Accepted

## Context

One rule for all entries is one rule to learn and to code. Astro's glob loader gives `<slug>/index.json` the ID `<slug>`.

## Decision

- An entry is the folder `<collection>/<slug>/`, and a singleton is `<name>/`. The folder holds `index.json` with the structured fields, one `.mdoc` file for each rich-text field, and the entry's own files in `media/`. The shared `media/` folder is at the content root, so `media` is a reserved name.
- Mica reads the slug field from the folder name, whatever the file holds. The slug is typed `string`, never `null`. A collection has one slug field.
- A row of a repeater with rich text has a key, `_key`: a letter, then 3 to 15 letters or digits. Its `.mdoc` files use the key: `sections.k3f9a2.body.mdoc`. The editor gives a new or copied row a new key. Templates do not get the key.
- A file where an entry folder belongs, and a `.mdoc` file of a row that does not exist, are not read. `mica check` warns about them.

## Consequences

- A small collection has many folders and many `index.json` files.
- A file whose slug value differs from its folder name is read with the folder name. The next save corrects the file.
- A moved row keeps its file names, so a new order does not look like changed text.
- Revisit when: never in 1.x. The rule is part of the content format (`docs/content-format.md`).

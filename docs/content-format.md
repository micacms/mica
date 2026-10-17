# The Mica content format

**Version 1**, for Mica 1.x. This document is normative. The words MUST, MUST
NOT, SHOULD and MAY are used as in RFC 2119. A tool that writes content which
Mica reads, or reads content which Mica writes, follows these rules. Every
example here is a fixture in `packages/core/test/fixtures/format/`, and a test
reads it with Mica and writes it back byte for byte.

The content model (`src/mica.ts`) defines the collections, the singletons and
their fields. This document says how their content is stored. The model itself
is in [Content model](https://micacms.com/docs/content-model/) and
[Fields](https://micacms.com/docs/reference-fields/).

## 1. The content root

All content is in one folder, the **content root**, in a Git repository. The
content root holds:

| Path | What it is |
| --- | --- |
| `.mica/schema.json` | The model, written by the Astro build (section 9). |
| `<collection>/` | One folder for each collection. |
| `<collection>/<slug>/` | One folder for each entry of a collection. |
| `<collection>/_order.json` | The manual order of a collection (section 7). Optional. |
| `<singleton>/` | One folder for each singleton. |
| `media/` | Shared media (section 6). |

Anything else in the content root MUST be left alone by a writer and MUST be
ignored by a reader.

### 1.1 Names

- A collection, singleton or field name MUST match `^[a-z][a-zA-Z0-9]*$`.
- Collection and singleton names share one namespace: a name MUST NOT be used
  twice, and two names MUST NOT differ only in case, because they are one
  folder on macOS and Windows.
- These names are reserved and MUST NOT name a collection or a singleton:
  `collections`, `singletons`, `protocolVersion`, `generatedBy`, `media`.

### 1.2 Paths

A path in the content is relative to the content root and uses `/`. A path
MUST NOT contain an empty segment, `.`, `..` or `.git` (in any case), a `\`,
a control character, or a drive letter. A reader MUST refuse such a path.

### 1.3 Slugs

An entry's slug is the name of its folder. It MUST match
`^[a-z0-9]+(?:-[a-z0-9]+)*$`, and SHOULD be at most 96 characters. A folder
whose name is not a slug is not an entry, and a reader MUST ignore it. The
first `slug()` field among a collection's own fields holds the same value; on
read, the folder name wins.

## 2. An entry

An entry of a collection and a singleton are stored the same way: a folder
with a file `index.json`. A folder without `index.json` is not an entry (it can
hold uploads for an entry that is not saved yet).

```text
posts/
├── _order.json
├── hello-world/
│   ├── index.json        the structured fields
│   ├── body.mdoc         one file for each rich-text field
│   └── media/cover.jpg   the entry's own media
└── second-post/
    └── index.json
site/
└── index.json            a singleton
```

### 2.1 `index.json`

- It MUST be a JSON object, encoded in UTF-8.
- A writer MUST write it with an indent of two spaces and a final newline, as
  `JSON.stringify(value, null, 2) + "\n"` does.
- A writer MUST write the declared fields in the order of the model, then the
  keys that the model does not declare (section 8), in their stored order. So
  the same content always gives the same bytes.
- A rich-text field is never a key of `index.json` (section 3).
- A writer MUST write every declared field, with its empty value when it holds
  nothing (section 4).

`posts/hello-world/index.json`:

```json
{
  "title": "Hello, world",
  "slug": "hello-world",
  "publishDate": "2026-10-14",
  "cover": {
    "path": "media/cover.jpg",
    "alt": "A desk by a window"
  },
  "tags": [
    "news"
  ]
}
```

`posts/second-post/index.json`, with empty values:

```json
{
  "title": "Second post",
  "slug": "second-post",
  "publishDate": null,
  "cover": null,
  "tags": []
}
```

`site/index.json`, a singleton:

```json
{
  "name": "Example",
  "live": true,
  "logo": "/media/logo.png"
}
```

## 3. Rich text

- A rich-text field is stored as Markdoc, in a file beside `index.json`.
- The file name is the field's path, with `.` between the segments, and
  `.mdoc` at the end: `body.mdoc`, `seo.intro.mdoc`.
- Inside a repeater, the segment for a row is the row's key (section 5), not
  its number: `sections.k7f3a9.text.mdoc`.
- A writer MUST write the text without leading or trailing white space, and
  with one final newline. An empty field MUST have no file.
- A reader MUST read a missing file as an empty field (`null`).

`posts/hello-world/body.mdoc`:

```markdoc
The first post. It has **bold** text and [a link](/media/price-list.pdf).
```

### 3.1 The Markdoc that the editor keeps

The editor shows and edits this subset of Markdoc: paragraphs, line breaks,
**bold**, *italic*, ~~strikethrough~~, inline code, links, headings,
block quotes, horizontal rules, code blocks, bullet and numbered lists, tables
with a header row and one line of text in each cell, and images on a line of
their own.

A document with anything else, such as a tag (`{% … %}`), a variable, HTML, a
comment, front matter, an annotation (`{% .class %}`), a link or image title,
aligned table columns, an image inside a line of text or a list, or Markdoc
that does not parse, MUST NOT be changed by the editor: it shows it read-only.
A website MAY render more of Markdoc than the editor edits.

### 3.2 Links and images in rich text

A link or image target is one of:

- a path from the entry's folder: `media/house.jpg`;
- a path from the content root, with a leading `/`: `/media/price-list.pdf`;
- an address on the web, another scheme such as `mailto:`, or an anchor
  (`#…`). These are not content.

A path that leads above the content root MUST NOT be resolved.

## 4. Field values

| Field | JSON value | Empty value | Example |
| --- | --- | --- | --- |
| `text()` | string | `null` | `"Hello, world"` |
| `textarea()` | string, with `\n` | `null` | `"Who we are."` |
| `richText()` | a `.mdoc` file (section 3) | no file | |
| `number()` | number | `null` | `2019` |
| `boolean()` | `true` or `false` | `false` | `true` |
| `date()` | `"YYYY-MM-DD"` | `null` | `"2026-10-14"` |
| `date({ includeTime: true })` | ISO 8601 with its offset | `null` | `"2026-10-14T09:30:00+02:00"` |
| `email()` | string, lower case | `null` | `"hello@example.com"` |
| `url()` | `http://` or `https://` URL | `null` | `"https://example.com"` |
| `slug()` | slug (section 1.3) | `null`; never in a collection's own fields | `"hello-world"` |
| `select()` | one `value` of the options | `null` | `"page"` |
| `select({ multiple: true })` | list of `value`s | `[]` | `["buyers", "press"]` |
| `relation()` | slug of an entry | `null` | `"contact"` |
| `relation({ multiple: true })` | list of slugs | `[]` | `["contact"]` |
| `media()` | path (section 6) | `null` | `"media/cover.jpg"` |
| `media({ multiple: true })` | list of paths | `[]` | |
| `media({ alt })` | `{ "path": …, "alt": … }`, keys in this order | `null` | section 2.1 |
| `color()` | `#rgb`, `#rrggbb` or `#rrggbbaa` | `null` | `"#17694f"` |
| `coordinates()` | `{ "lat": …, "lng": … }`, and `"zoom"` (0 to 22) from a field with a map, keys in this order | `null` | `{ "lat": 47.3769, "lng": 8.5417, "zoom": 15 }` |
| `tags()` | list of strings | `[]` | `["news"]` |
| `object()` | object of its fields | an object of empty values | section 5 |
| `repeater()` | list of rows (section 5) | `[]` | section 5 |

- A reader MUST read a missing value as the empty value. It MUST NOT use the
  field's `default`: a default fills only a new entry, and a singleton that
  has no file yet.
- A writer MUST NOT store a value outside these types, lengths and ranges. A
  saved draft MAY leave a `required` field empty; Publish refuses it.

## 5. Objects and repeaters

An object is a JSON object of its fields, with the rules of section 2.1. A
repeater is a list of such objects, one for each row.

A row of a repeater whose fields hold rich text, at any depth, MUST have a key
as its first property: `"_key"`, a letter and then 3 to 15 lower-case letters
or digits (`^[a-z][a-z0-9]{3,15}$`). The key names the row's `.mdoc` files, so
a new order of the rows changes only `index.json`. Keys MUST be unique within
one repeater. A writer MUST give a row without a valid or unique key a new one,
and MUST keep an existing key. A row without rich text has no key. A website
does not get the key.

`pages/about/index.json`:

```json
{
  "title": "About us",
  "slug": "about",
  "seo": {
    "description": "Who we are."
  },
  "sections": [
    {
      "_key": "kintro",
      "heading": "Who we are"
    },
    {
      "_key": "k7f3a9",
      "heading": "How we work"
    }
  ],
  "facts": [
    {
      "label": "Founded",
      "value": 2019
    },
    {
      "label": "People",
      "value": 12
    }
  ],
  "kind": "page",
  "audiences": [
    "buyers",
    "press"
  ],
  "related": [
    "contact"
  ],
  "accent": "#17694f",
  "place": {
    "lat": 47.3769,
    "lng": 8.5417
  },
  "contact": "hello@example.com",
  "website": "https://example.com"
}
```

`pages/about/seo.intro.mdoc`:

```markdoc
We build *small* websites.
```

`pages/about/sections.kintro.text.mdoc`:

```markdoc
A team of twelve.
```

`pages/about/sections.k7f3a9.text.mdoc`:

```markdoc
- Plan
- Build
- Look after it
```

`pages/contact/index.json`, with empty values:

```json
{
  "title": "Contact",
  "slug": "contact",
  "seo": {
    "description": null
  },
  "sections": [],
  "facts": [],
  "kind": null,
  "audiences": [],
  "related": [],
  "accent": null,
  "place": null,
  "contact": null,
  "website": null
}
```

## 6. Media

- An entry's own media are in its folder, in `media/`.
- Shared media are in `media/` at the content root. A name of a file in
  `media/` SHOULD be lower case, with `-` between words.
- A `media()` value is written in one of two forms:
  - a path from the entry's folder, for a file in the entry's own `media/`:
    `"media/cover.jpg"`;
  - a path from the content root, with a leading `/`, for any other file:
    `"/media/logo.png"`.
- A reader MUST resolve both forms to a path from the content root, and a
  writer MUST write the first form for a file in the entry's folder and the
  second for any other.
- A media path MUST stay inside the content root (section 1.2).
- The value has the same form for every file type. Which types a field takes
  is the `accept` option of its model, not a part of the stored value.

## 7. The order of a collection

Without `_order.json`, the entries are in the order of their slugs, by UTF-16
code unit, as Git lists files. `_order.json` MUST be a JSON array of slugs:

`posts/_order.json`:

```json
[
  "second-post",
  "hello-world"
]
```

A reader MUST put the listed slugs first, in their order, and MUST then put
the other entries in the order of their slugs. A listed slug without an entry
MUST be ignored. A file that is not a JSON array is an error.

## 8. What the model does not declare

A writer MUST keep, and a reader MUST NOT give to a website:

- a key of `index.json`, of an object, or of a row with a key, that the model
  does not declare;
- a `.mdoc` file whose path does not lead to a rich-text field of the model.

A writer MAY drop a key in a row without a key, because such a row has no
identity when the order changes. A writer MUST delete a `.mdoc` file that the
model declares when the field is empty or its row is gone. When an entry gets
a new slug, a writer MUST move every file of its folder.

`team/anna-vogt/index.json`, where the model has no `phone`:

```json
{
  "name": "Anna Vogt",
  "slug": "anna-vogt",
  "role": "Lead",
  "phone": "+41 44 000 00 00"
}
```

`team/anna-vogt/bio.mdoc`, where the model has no `bio`:

```markdoc
Content for a field that a newer model adds.
```

## 9. The manifest

`.mica/schema.json` is the model as data, written by `@micacms/astro`. It is a
JSON object with:

- `protocolVersion`: `1`.
- `generatedBy`: the package that wrote it, without a version.
- `collections` and `singletons`: objects of the definitions, by name.

A definition keeps every field option as the model gives it, also an option
that changes only the editor, for example `"map": "liberty"` on a
`coordinates` field.

A reader MUST refuse a file without these four keys, and a `protocolVersion`
above the one it knows. `protocolVersion` changes only when an older reader
would misread a newer manifest. A field kind or a field option that a reader
does not know MUST make its collection or singleton read-only for that reader:
an option can change what is stored.

## 10. Versions of this format

This is version 1. A change that makes a reader of version 1 misread content
is a new major version of Mica. Before 1.0, Mica changed the format without a
migration.

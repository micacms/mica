# 46. A media value is one object, and Git is the built-in media provider

**Status:** Accepted. Replaces the value of a media field in [21](0021-field-rules.md) and in [23](0023-astro-integration.md).

## Context

Some sites keep their media in a system of their own, such as a DAM. A value that is only a path cannot name such a file. A second shape for external files would give the content format two shapes for one thing.

## Decision

- A media value is one object with a fixed part and a free part.
- The fixed part names the file: `path` for a file in Git, or `provider` and `id` for an external file. It also holds `alt`. For an external file, it holds a copy of the address, the type, the width and the height, so that the website builds without a call to the provider.
- The free part is `properties`: data of the provider or of the site. Mica keeps it and does not read it.
- A file in Git is `{ path, alt }`, with no `provider` key. Git is the built-in provider, and the rules of [18](0018-media-files.md) apply to it.
- A field stores an object with or without the `alt` option. The option only makes the editor ask for the text.
- In Astro, a `media({ accept: "image" })` field is `{ src, alt }`, ready for `<Image {...value} />`, with `""` for no alternative text and without `properties`. Other files are `{ path, alt }`.
- The alternative text is in the entry, not in the file. A provider can give a first value.
- An external provider is a plugin ([45](0045-plugins.md)). Mica refuses a value of a provider that it does not know. It lists, adds, changes and deletes files on its own system.
- The Media view shows the files of all providers in one view, in groups, with filters. A slow provider does not delay the others.

## Consequences

- An action on an external provider takes effect immediately, outside Publish. The editor marks such an action. Discard does not undo it.
- The copy in the entry can be older than the file at the provider.
- Mica checks links to Git files at Publish ([19](0019-links-and-reference-data.md)). For an external file, it can only ask the provider.
- A website without the provider's plugin can still show an external file, from the copy.
- Change this decision when: sites need the alternative text in one place for all uses of a file.

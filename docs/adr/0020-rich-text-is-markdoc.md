# 20. Rich text is Markdoc, and Mica never loses what it cannot show

**Status:** Accepted

## Context

Editors must not need a markup language. The stored file must stay readable in a diff. A conversion that drops a tag or an image writes that loss to the file at the next save.

## Decision

- Rich text is stored as Markdoc in a `.mdoc` file, never as HTML. The editor converts at the boundary and never calls Tiptap's `getHTML()` (`packages/editor-ui/src/lib/markdoc.ts`).
- The editor edits headings, lists, links, code, Markdown pipe tables and images on their own line. The toolbar presets are `"minimal"`, `"default"` and `"full"`, or a list. The schema always holds every node that the editor can show; the toolbar only limits the buttons.
- A field with content that the editor cannot show (a `{% tag %}`, an attribute, an image in a line, a complex table) opens read-only, shows the source and writes the text back unchanged. The field decides this when it loads. An edit never makes it read-only: the editor refuses an edit that would.
- One rule decides an image path: a content file that exists is used; a missing relative path is an error; a missing `/path` is allowed, because it can be a file of the website.
- The rich-text editor is a chunk of about 190 kB gzip. Only a form with a rich-text field loads it.

## Consequences

- A developer must change a field that is read-only for the editor.
- A table cell holds one line of text. Pasted HTML images are removed: an image must be a media file.
- Change this decision when: a site needs rich cells or its own tags. Then generate editor nodes from the model.

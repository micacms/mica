# 18. Media files: one table of types, checked by their bytes

**Status:** Accepted

## Context

The editor serves each file from its own origin, behind the session. A file that a browser runs as a page, such as an SVG with a script, runs with the editor's rights, Publish included.

## Decision

- `@micacms/core` has one table of the file types that Mica stores: images (JPEG, PNG, GIF, WebP, AVIF), PDF, GPX, KML, GeoJSON, ZIP and CSV. An upload finds the type from its bytes. The name decides only for ZIP and CSV. A text file is read, never parsed, so no XML or JSON parser gets an upload. A model cannot add a type.
- A media field's `accept` is `"image"`, `"document"` (PDF), `"any"` or a list such as `["gpx", "kml"]`.
- Mica never stores or shows SVG. An upload is checked by its bytes, so an SVG is refused whatever its name. A file in the repository is an SVG by its bytes or by its `.svg` name, so a comment at the start cannot hide one, and Mica does not list or serve it. To clean an SVG would need a large dependency and a security promise. Each served file has `Content-Security-Policy: sandbox; default-src 'none'` and `nosniff`. A file that is not an image is sent as an attachment.
- A file uploaded from an entry goes into that entry's `media/` folder, stored as `media/x.jpg`. A file uploaded in the Media view goes into the shared folder, stored as `/media/x.jpg`. The picker shows the entry's own files and the shared ones.
- The Media view deletes a file only when no document uses it. The delete is a pending change.
- Files upload one after another. A failed file shows its reason, and the others continue. Mica makes no smaller previews.

## Consequences

- Office files, plain text, audio, video and SVG stay out. A developer adds an SVG through Git.
- Deleting an entry deletes its own files. An image that two entries use is shared or stored twice.
- A grid of large photos loads the originals, which is slow over a slow connection.
- Change this decision when: a site needs another type (a row in the table and a check of its bytes), or editors need vector graphics (then sandboxed previews first).

# 19. Links are checked at Publish; reference data is an index

**Status:** Accepted

## Context

A broken link or a missing image on the website is silent loss, and Publish is the last point where Mica can stop it. Some sites link to thousands of items that nobody edits, such as places from a public dataset.

## Decision

- One rule in core finds the links of a document (`documentLinks`): its relations, its media fields, and the images and file links in its rich text. The reference check, the media usage, the delete check, the needs of Publish and `mica check` all use it.
- Publish refuses a change that would leave a link to a missing entry or file. A broken link in a document that the change does not touch does not block Publish. The Astro loader warns about each broken link, and `strict: true` fails the build.
- A relation stores the target's slug. When an entry's URL changes, the editor offers to update the links to it in the same save, with each referrer's revision checked.
- `defineSite({ references })` declares data of the website that Mica never edits: a JSON or CSV file, and the keys of the id and the title. The loader writes `.mica/references/<name>.json`, one item on each line. Mica reads only this index: the picker, Publish, `mica check` and the MCP tool `find_reference_items` use it.

## Consequences

- A deletion reads every collection, because a link can be anywhere.
- The URL of a deleted or moved page still needs a redirect, which is the developer's work.
- The reference index is committed and grows by about 40 bytes for each item. A remote source cannot be a reference set.
- Revisit when: the scan at a deletion becomes slow (then index the links), or reference data comes from an API.

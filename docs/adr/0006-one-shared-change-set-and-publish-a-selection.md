# 6. One shared change set, and Publish takes a selection

**Status:** Accepted

## Context

The editors of a site are usually its owners: a small team, often one person at a time. Drafts for each editor need merge rules and an answer to "who publishes whose work". A review queue that nobody empties is worse than no review. With all-or-nothing, a typo fix waits for a colleague's unfinished article, or carries it. With `required` at Save, a half-written article cannot be saved, and a closed tab loses it.

## Decision

- A site has one set of pending changes, not one for each editor. Each editor can publish from it.
- Save checks types and formats, but not `required`. An entry without a required value is saved and marked "Not ready to publish".
- The Publish page shows the pending changes in groups, and the editor selects groups. A group keeps together what must not split:
  - an entry with its own files, or a singleton;
  - the two halves of a URL change;
  - one shared file.
- Selecting a document also selects the new files and entries that it needs.
- A collection's `_order.json` is a group of its own. The order accepts a slug that it does not list, so each half can be published first.
- A deletion does not take along the edits that remove the links to it. Publish refuses such a selection and says "publish them together".
- Publish refuses an incomplete group, and a selection that would break a link ([19](0019-links-and-reference-data.md)).
- Publish writes directly to the branch that the website builds. Mica opens no pull request.
- A deleted and a new entry of one collection show as one renamed entry when at least half of their non-empty fields agree. Git uses the same idea for a rename.
- When a save finds a newer save of the same document, the editor sees both versions, field by field, and chooses "Keep mine" or "Use theirs". The log names who chose.

## Consequences

- An editor can publish a colleague's finished entry. The colleague's unfinished entry stays a draft.
- A typo is on the website when the build finishes. For a review step, point Mica at a staging branch and merge it by hand.
- In the local editor, the working tree is the draft area, so `astro dev` sees an incomplete entry. The Astro loader leaves such an entry out in dev, with a warning; `astro build` fails.
- Change this decision when: two editors often work at the same time, or a site needs four eyes before Publish.

# 27. The 1.0 scale target, and views that read only what they show

**Status:** Accepted

## Context

Mica is for brochure and agency sites with a blog or a news archive. A view that reads the whole site is fast with ten entries and slow with a thousand.

## Decision

- Mica 1.0 promises 1,000 entries in a collection, 5,000 files in the content tree and 5 editors at the same time. `runtime/test/budgets.test.ts` uses a fixture of that size and fails when a view reads more than its budget.
- Each view reads in proportion to what it shows. Opening an entry reads its files only. Lists and counts use `stat` and directory listings. A full collection is read eight entries at a time.
- No whole media file is in memory. Uploads stream to a temporary file, revisions are streamed hashes, and the file route streams. A temporary file is named `*.mica-<pid>-<n>` and removed at start.
- Search filters in the browser.

## Consequences

- Above the target, Mica can work, but it makes no promise. A site with a larger archive splits it into more collections.
- A deletion still reads every collection ([19](0019-links-and-reference-data.md)).
- Revisit when: an adopter is above the target. Measure their shape first, then add an index of titles and links, and search and paging on the server.

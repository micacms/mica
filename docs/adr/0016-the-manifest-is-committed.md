# 16. The manifest is committed, and changes only with the model

**Status:** Accepted

## Context

Mica needs the model, but must not run the website's code. The content already travels through Git.

## Decision

- The Astro loader writes the model to `.mica/schema.json` in the content root. The file is committed. In CI (`CI` set), the loader does not write it: the build fails when the committed file is not the model in the code.
- The file holds the model, `protocolVersion` and `generatedBy` (`"@micacms/astro"`, without a version). Nothing else: no version, no time, no build data, so that a release of Mica or of `@micacms/astro` does not change each committed manifest. `readManifest` in core validates it at start, and `mica check` runs the same check. There is no separate JSON Schema.
- `defineSite({ root })` is the one setting for the content root. The CLI and the image find the root by its `.mica/schema.json`. A path is necessary only when there are several: a CLI argument, or `MICA_CONTENT_PATH` for the image. For the image, the top of the repository cannot be the content root, because `.git` would then be in it. The local editor accepts it.
- Mica uses a new model without a restart. It compares the manifest's revision at most every two seconds on admin requests, before Publish, and after a fast-forward that changed it. An open page that sees a newer model asks the editor to save and reload.

## Consequences

- A model change is reviewed in the same diff as the content.
- A manifest that somebody forgot to rebuild fails the CI build.
- The manifest does not say which `@micacms/astro` wrote it; the lock file does. A reader acts on `protocolVersion` and on the field kinds.
- Change this decision when: a tool outside Mica must validate the file without Mica. Then generate a JSON Schema from the same source as the types.

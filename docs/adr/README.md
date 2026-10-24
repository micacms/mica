# Architecture decision records

Each record states a decision that is still true: its context, the decision and its consequences. [`docs/architecture.md`](../architecture.md) describes how the parts fit together.

## Rules

- One file for each decision, numbered in order: `NNNN-short-title.md`, with **Status**, **Context**, **Decision** and **Consequences**. Keep a record short: about 40 lines at most.
- A record describes the current design. It does not tell the history of a feature. Git keeps the history.
- Do not change the meaning of an accepted record. For a new decision, add a new record, and set the status of the old one to "Replaced by [NNNN](…)". Corrections of facts and wording are allowed.
- Priorities, milestones and known gaps are on GitHub: issues, milestones and the label `known-gap`.

## Foundations

- [1. Git is the source of truth, and Mica keeps no database](0001-git-is-the-source-of-truth.md)
- [2. A local editor without sign-in, and a self-hosted image behind OIDC](0002-a-local-editor-and-a-self-hosted-image.md)
- [3. Admission is a rule over provider claims, not an account](0003-admission-by-provider-claims.md)
- [4. A session is a sealed cookie, and the server keeps no state about people](0004-sealed-sessions-and-no-state-about-people.md)
- [5. Configuration: `MICA_` names, no development mode, secrets from files](0005-configuration-names-and-secrets.md)

## Drafts and publishing

- [6. One shared change set, and Publish takes a selection](0006-one-shared-change-set-and-publish-a-selection.md)
- [7. A self-hosted Mica keeps its own Git clone](0007-self-hosted-mica-keeps-its-own-clone.md)
- [8. Sync never merges, and Mica finds the conflicts itself](0008-sync-never-merges.md)
- [9. Publish commits the reviewed paths](0009-publish-commits-the-reviewed-paths.md)
- [10. Git on the server is isolated, and the token never touches the disk](0010-git-on-the-server-is-isolated.md)
- [11. Git LFS holds the media that the site owner gives to it](0011-git-lfs-for-media.md)
- [12. The content can be in a Git submodule](0012-content-in-a-git-submodule.md)
- [13. Any Git host over HTTPS; supported means live-tested](0013-any-git-host-over-https.md)

## Content format

- [14. Each entry is a folder, and its URL is the folder name](0014-each-entry-is-a-folder.md)
- [15. A save keeps what the model does not declare](0015-a-save-keeps-what-the-model-does-not-declare.md)
- [16. The manifest is committed, and changes only with the model](0016-the-manifest-is-committed.md)
- [17. A model that Mica cannot fully read makes it read-only, not stopped](0017-an-unknown-field-makes-its-collection-read-only.md)
- [18. Media files: one table of types, checked by their bytes](0018-media-files.md)
- [19. Links are checked at Publish; reference data is an index](0019-links-and-reference-data.md)
- [20. Rich text is Markdoc, and Mica never loses what it cannot show](0020-rich-text-is-markdoc.md)
- [21. Rules of the field kinds](0021-field-rules.md)
- [22. No native multilingual content in 1.0](0022-no-native-multilingual-content.md)

## Websites and setup

- [23. `@micacms/astro` gives what each website needs](0023-astro-integration.md)
- [24. Setup: guides in the package, a starter, and `mica import`](0024-setup-starter-and-import.md)

## Editor

- [25. The editor speaks of saving and publishing, not of Git](0025-editor-words.md)
- [26. Preview in the local editor only; a link to the published page](0026-preview.md) (replaced by 37)
- [27. The 1.0 scale target, and views that read only what they show](0027-scale-target.md)
- [36. The editor saves by itself](0036-the-editor-saves-by-itself.md)
- [37. A live preview beside the form; a link to the published page](0037-live-preview.md)
- [38. A live preview for the self-hosted Mica, on an origin of its own](0038-self-hosted-live-preview.md)
- [39. The self-hosted editor and its preview can run on demand](0039-self-hosted-editor-and-preview-run-on-demand.md) (proposed)

## Agents

- [28. Agents edit through MCP, and save drafts by default](0028-agents-edit-through-mcp.md)
- [29. A self-hosted Mica is the authorization server of its MCP endpoint](0029-mica-is-the-authorization-server-for-mcp.md)

## Releases and project

- [30. Semver covers the public surface, not each published package](0030-semver-covers-the-public-surface.md)
- [31. Support: current platforms, and fixes for the latest minor only](0031-support-policy.md)
- [32. 1.0 ships after four weeks of a release candidate on a production website](0032-release-candidates.md)
- [33. Rush drives the monorepo](0033-rush-drives-the-monorepo.md)
- [34. A hobby project: best effort, no outside audits before 1.0, docs on the website](0034-a-hobby-project-without-audits.md)
- [35. What 1.0 does not do](0035-scope-of-1-0.md)

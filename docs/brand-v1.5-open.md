# Brand v1.5: open items

This branch changes the editor UI (`@micacms/editor-ui`) to the v1.5 brand. This file lists the work that is not done. Remove it before the merge.

## Brand v1.5

- Wordmark: `micacms` in lowercase. `mica` in Inter Display Bold (700), `cms` in Inter Display Light (300), tracking −3 %, outlined to paths.
- Favicon: the `m` from the wordmark, creme on aubergine, rounded square.
- Colors: aubergine `#3F1F2B`, creme `#FBF5EC`.
- Font: Inter only. Outfit is removed.

## Not verified

- `rush typecheck`, `rush test` and `rush build` were not run. The dependencies are not installed in this worktree.
- The editor was not examined in a browser.

## Open items

- [ ] Run `rush install`, `rush typecheck`, `rush test` and `rush build`.
- [ ] Examine all views in the browser: login, overview, changes, forms, dialogs, errors.
- [ ] Sidebar: the change count badge uses `bg-accent` (`#7A3D58`) on aubergine. The contrast is low. Use creme with aubergine text, or similar.
- [ ] Sidebar: the nav headings (`text-white/35`) and the sign-out link (`text-white/40`) have low contrast on aubergine. Examine and increase if necessary.
- [ ] Sidebar uses `white` alpha values for text and borders. Change them to creme if the tint is visible.
- [ ] Status colors (`success`, `warning`, `danger`, `info`) are not changed. Make sure that they look correct on the creme surfaces.
- [ ] The Tailwind token names `stone`, `brand` and `glimmer` are kept so that the components do not change. Rename them in a separate change if necessary.
- [ ] `PageHeader.vue` uses `font-display` with `tracking-[.02em]`. Now that display is Inter, examine the tracking.
- [ ] Wordmark: the kerning is the Inter default. Do a manual optical adjustment, mainly at the `a|c` join between `mica` and `cms`.
- [ ] Favicon at 16 px: a separate file with a larger `m` exists in the brand package (`favicon-16.svg`). Decide if the UI needs it.
- [ ] `sites/micacms` still uses the v1.0 brand (`global.css`, `Logo.astro`, `EditorPreview.astro`). This needs approval (see `AGENTS.md`).
- [ ] `examples/muster-consulting`: examine for brand references.
- [ ] Record a change file with `rush change` for `@micacms/editor-ui`.

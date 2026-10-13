# Finish the setup

## 1. Add scripts

Add two scripts to `package.json`, so that the user has short commands:

```json
"mica": "mica",
"check": "mica check && astro check"
```

- If the project has no `@astrojs/check`, use `"check": "mica check"`. Do not
  install it only for this: without it, `astro check` asks to install it, and a
  script cannot answer. Tell the user that nothing checks the types in
  `.astro` files.
- If the project already has a `mica` script, keep it. If it has a `check`
  script without `mica check`, ask the user whether to add `mica check &&` in
  front of it. If the user says no, use `npx mica check` in place of
  `npm run check` in the steps below and in the notes.

## 2. Check

All three must pass:

```bash
npx astro sync
npm run check      # mica check: 0 errors; then astro check, if it is there
npx astro build
```

If `astro check` reports errors that were there before you started, tell the
user. Do not fix them unless the user asks.

Explain each warning of `mica check` to the user, or fix it.

## 3. Add notes for the next agent

Add this section to the project's agent instructions: `AGENTS.md`,
`CLAUDE.md` or the file the project already uses. If `CLAUDE.md` is a link to
`AGENTS.md`, edit `AGENTS.md`. Make the file if there is none. Change the
paths if the project uses others.

```markdown
## Content (Mica)

- The content model is `src/mica.ts`. The content is JSON and Markdoc in
  `content/`; editors change it with `npm run mica`.
- After a change to `src/mica.ts`, run `npx astro sync` and `npm run check`,
  and commit `content/.mica/schema.json` with the change.
- Renaming or removing a field or a collection does not move the stored
  content. Change the content files in the same commit, or ask first.
- Before a commit that changes `content/`, `npm run check` must pass.
```

## 4. Tell the user

- What you added and changed, file by file.
- The decisions they made, and what was not converted, if anything.
- What to commit: every file that `git status` shows as new or changed,
  including `content/.mica/schema.json`, `package.json` and the lock file. Do
  not commit for them unless they asked.
- How to edit: `npm run mica` opens the editor on this computer. A save writes
  files in `content/`; Publish commits them. `npm run check` checks the content
  (and the types, if `@astrojs/check` is there). `@micacms/editor` is a dev
  dependency, so on another clone, run `npm install` first.
- That a self-hosted editor for other people is described at
  https://micacms.com/docs/self-hosting/.

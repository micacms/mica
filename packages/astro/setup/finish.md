# Finish the setup

## 1. Check

All three must pass:

```bash
npx astro sync
npx mica check     # 0 errors
npx astro build
```

If the project has `@astrojs/check`, run `npx astro check` too. Do not install
it only for this. Without it, nothing checks the types in `.astro` files: tell
the user.

Explain each warning of `mica check` to the user, or fix it.

## 2. Add notes for the next agent

Add this section to the project's agent instructions: `AGENTS.md`,
`CLAUDE.md` or the file the project already uses. If `CLAUDE.md` is a link to
`AGENTS.md`, edit `AGENTS.md`. Make the file if there is none. Change the
paths if the project uses others.

```markdown
## Content (Mica)

- The content model is `src/mica.ts`. The content is JSON and Markdoc in
  `content/`; editors change it with `npx mica`.
- After a change to `src/mica.ts`, run `npx astro sync` and `npx mica check`,
  and commit `content/.mica/schema.json` with the change.
- Renaming or removing a field or a collection does not move the stored
  content. Change the content files in the same commit, or ask first.
- Before a commit that changes `content/`, `npx mica check` must report 0 errors.
```

## 3. Tell the user

- What you added and changed, file by file.
- The decisions they made, and what was not converted, if anything.
- What to commit: every file that `git status` shows as new or changed,
  including `content/.mica/schema.json`, `package.json` and the lock file. Do
  not commit for them unless they asked.
- How to edit: `npx mica` opens the editor on this computer. A save writes
  files in `content/`; Publish commits them. `@micacms/editor` is a dev
  dependency, so on another clone, run `npm install` first.
- That a self-hosted editor for other people is described at
  https://micacms.com/docs/self-hosting/.

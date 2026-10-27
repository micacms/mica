# Finish the setup

## 1. Add the live preview and scripts

Add `micaPreview()` to the integrations in `astro.config.*`. It marks the
page only in `MICA_PREVIEW=1 astro dev`, which `mica start --preview`
starts: then the editor shows the page beside the form, and a click on a text
in the page opens its field. A build and a plain `astro dev` do not change.

```js
import { micaPreview } from "@micacms/astro/preview";

export default defineConfig({
  integrations: [micaPreview()],
});
```

Keep the integrations that are there, and add it to them.

Add two scripts to `package.json`, so that the user has short commands:

```json
"mica": "mica start --preview",
"check": "mica check && astro check"
```

- `--preview` starts the project's `astro dev` with `MICA_PREVIEW=1` beside
  the editor, and stops it with the editor.
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
  `content/`; editors change it with `npm run mica`. It also starts the dev
  server, so the editor shows the page next to the form.
- After a change to `src/mica.ts`, run `npx astro sync` and `npm run check`,
  and commit `content/.mica/schema.json` with the change.
- Renaming or removing a field or a collection does not move the stored
  content. Change the content files in the same commit, or ask first.
- Before a commit that changes `content/`, `npm run check` must pass.
- To change content, use the Mica MCP tools if you have them
  (https://mica.build/docs/agents/). Call `describe_model` first. A save
  is a draft: do not publish unless the user asks.
```

Change no other documentation, such as `README.md`, unless the user asks.

## 4. Tell the user

Your last message is the report. Its commands are for this one time: do not
write them into `README.md` or another file. Use this form, with the real
files from `git status`:

````markdown
## Done

Mica is set up. <one sentence on what editors can now edit>.

**What changed:** <file by file, one line each: what and why, in plain words>.
**Your decisions:** <each decision from the proposal, and the choice>.
**Not converted:** <anything that was not converted, or "nothing">.
**Checks:** `npm run check` and `npx astro build` pass. <how the website
compares with the version before>.

## Commit it

```bash
# 1. The setup: packages, Astro config, model, collections config, agent notes.
git add package.json package-lock.json astro.config.mjs src/mica.ts \
  src/content.config.ts content/.mica/schema.json AGENTS.md <other setup files>
git commit -m "Add Mica"
# 2. The content and the page changes.
git add -A
git commit -m "Move the content to Mica"
# 3. Push once, so that the branch has an upstream before the first Publish.
#    In a new project, add the remote first: git remote add origin <url>
git push -u origin <branch>
```

## Edit the content

`npm run mica` opens the editor on this computer, and starts the website's
dev server beside it: the editor shows the page next to the form, and a click
on a text in the page opens its field. A save writes files in `content/`;
Publish commits them, and pushes a new branch the first time.
`npm run check` checks the content (and the types, if `@astrojs/check` is
there). On another clone, run `npm install` first. A self-hosted editor for
other people: https://mica.build/docs/self-hosting/.
````

- Use the project's lock file (`pnpm-lock.yaml`, `yarn.lock`) and package
  manager.
- For a new project without converted content, one commit is enough.
- Run the commands only if the user asks.

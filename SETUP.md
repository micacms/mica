# Set up Mica — instructions for a coding agent

Mica is a Git-based CMS for Astro. The content model is TypeScript in the
Astro project (`src/mica.ts`). The content is JSON and Markdoc files in the
repository (`content/`). Editors change it with the Mica editor, which writes
files and commits them. There is no database and no content API.

This file finds the situation of the project and sends you to the guide for
it. The guides are in the `@micacms/astro` package, so they always match the
installed version.

## Rules

- Ask the user before you make a decision that changes their website or their
  content. Each guide names these decisions. Stop and wait for the answers.
- Before you change a page, a component, a layout, a style or a config file,
  show the user what will change and why, in plain words, with your
  recommendation. Continue after the user agrees.
- Do not change `README.md` or other documentation unless the user asks.
- Do not delete or overwrite content until `npx mica check` reports 0 errors
  and the user agrees.
- Do not commit, push or deploy unless the user asks you to.
- Use the package manager that the project uses (npm, pnpm, yarn or bun). The
  commands below use npm.

## 1. Requirements

- A Node.js version that Mica supports: compare `node --version` with
  `npm view @micacms/editor engines`.
- Git. Mica works on a Git working tree. If the directory is not a Git
  repository yet, ask the user whether to run `git init`.

## 2. Find the situation

| What you find                                                                         | Situation                      | Guide                         |
| ------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------- |
| No `package.json`, or a directory with no Astro project                               | New project                    | `new-project.md`              |
| An Astro project with no content collections                                          | Empty Astro project            | `new-project.md`              |
| An Astro project with collections in `src/content.config.*` or `src/content/config.*` | Astro with content collections | `content-collections.md`      |
| The user wants to move content from WordPress or another CMS                          | Another CMS                    | `other-cms.md`                |
| `src/mica.ts` exists                                                                  | Mica is already set up         | Stop. Ask the user what to do |

The project must use an Astro version that `@micacms/astro` supports. See
`npm view @micacms/astro peerDependencies`. For another Astro version, stop
and ask the user whether to change Astro first.

If the situation is not clear, ask the user.

## 3. Create the Astro project (new project only)

For a new project, create it in the current directory. If the directory is not
empty, ask the user where to create the project first.

```bash
npm create astro@latest . -- --template minimal --install --no-git --skip-houston --yes
```

## 4. Install Mica

```bash
npm install @micacms/astro @micacms/core
npm install --save-dev @micacms/editor
```

If npm reports a peer dependency conflict with `astro`, the new project has an
Astro version that Mica does not support yet. Install the Astro version that
`npm view @micacms/astro peerDependencies` names, then install Mica again.

The guides are in `node_modules/@micacms/astro/setup/`. If that directory does
not exist, the release does not have the guides yet. Install all three
packages with the `@next` tag instead (`@micacms/astro@next`,
`@micacms/core@next`, `@micacms/editor@next`). If the directory is still
missing, stop and tell the user.

## 5. Follow the guide

Read `node_modules/@micacms/astro/setup/<guide>` from the table in step 2, and
follow it from start to end. Every guide ends with `finish.md`.

When you are done, your last message is the report that the guide describes:
what you did, which decisions the user made, the commands to commit and push,
and how to open the editor. Write the commands in the message, not in a file.

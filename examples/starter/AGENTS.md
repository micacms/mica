# AGENTS.md

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
  (https://micacms.com/docs/agents/). Call `describe_model` first. A save
  is a draft: do not publish unless the user asks.

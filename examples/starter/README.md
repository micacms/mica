# Mica starter

A small Astro site with [Mica](https://micacms.com): one collection of posts, one
settings page, an image with alt text, and a CI workflow that checks the content.

## Start

```bash
npm create astro@latest -- --template micacms/mica/examples/starter
cd <your-project>
npm install
git init && git add -A && git commit -m "Start from the Mica starter"
```

Then, in two terminals:

```bash
npm run dev    # the website, at http://localhost:4321
npm run mica   # the editor, at http://localhost:6422
```

Change the post in the editor and save: the website shows it at once. Publish
commits the change and pushes it. Before the first Publish, create an empty
repository on your Git host and push the starter's commit once:

```bash
git remote add origin <url>
git push -u origin main
```

## What is where

| File | What it does |
| --- | --- |
| `src/mica.ts` | The content model: the fields of a post and of the settings page |
| `src/content.config.ts` | Makes Astro collections from the model |
| `content/` | The content, as JSON and Markdoc files, with the images next to them |
| `content/.mica/schema.json` | The model for the editor; the build writes it, commit it |
| `src/pages/` | The pages: a list of posts, and one page per post |
| `.github/workflows/check.yml` | `mica check` and the build, on every push |

## Next

- Add a field in `src/mica.ts`, run `npm run dev` once, and the editor shows it.
- `npm run check` runs `mica check` and `astro check` together.
- Let editors who are not developers edit with the self-hosted editor:
  https://micacms.com/docs/self-hosting/

# Brand

The brand book of Mica: who Mica is for, the colours, the type, the logo, the motif and the layout rules, for the website, the docs and the editor. The words are in [voice.md](voice.md). The values of every token, for the light theme (Stone) and the dark theme (Basalt), with their contrast ratios, are in [tokens.json](tokens.json).

The tokens are implemented in two places: `sites/micacms/src/styles/global.css` (the website and the docs) and `packages/editor-ui/src/style.css` (the editor). Each file defines only the tokens that its surface uses: the editor has no strata bands, for example. A change to a token goes into `tokens.json` and into each file that uses it, with its contrast checked in both themes.

Mica is a content editor for Astro websites. It keeps the content as plain files in the website's own Git repository: no database, no vendor, one tidy commit for each publish. The brand is **down to earth**: Astro reaches for the stars, Mica is the rock under your content.

## Foundations

**Who it is for.** A small team with a content-driven website on Astro. One developer sets it up. Two to five people write. They know their business, not Git.

**What it promises.** Forms for the editors. Plain files in Git for the developer. One tidy commit for each publish. No database, no vendor, no surprise in the build.

**Personality.**

| Trait | It means | It does not mean |
| --- | --- | --- |
| Calm | Few colours, quiet layouts, no hurry. The editor is a place to work. | Hype, exclamation marks, motion for its own sake. |
| Clear | Like the mineral: you can see through it. Files you can read, words you understand. | Jargon, magic, hidden state. |
| Grounded | Boring technology, done well: Git, files, static sites. | Buzzwords and trends. |
| Friendly | A small wink where it helps. Astro gets a friendly nod. | Forced jokes, memes, a joke at the reader's cost. |

**The name.** Mica is a mineral that splits into thin, clear sheets that catch the light. Use these ideas, and no others: *layers* (each publish is one more layer), *clear* (nothing hidden in a database), *a glint* (an editor that feels good), *down to earth* (Astro is in the sky; Mica is a rock).

## Three surfaces, one brand

The same tokens serve three surfaces. Each one uses a different amount of the brand.

| | Website | Docs | Editor |
| --- | --- | --- | --- |
| Voice | Warmer, still short; a wink is allowed | Simplified Technical English | Plain, a bit warm |
| Type | `display`, `title-1`–`title-3`, `lead`, `body` | `title-1` for the page title, then `body`, `code` | `editor-*` styles only |
| Colour | All tokens, `band-*` in the strata motif | Neutrals, `primary` for links, notices | Neutrals, `primary` for actions, statuses |
| Motif | Strata in the hero and the footer, glint, the rocket (once) | The footer strata only; diagrams | None; `glint` only in the Not published status |

## Colour

The palette is a cross-section through rock: Stone and Sandstone for the ground, Shale for the ink, Malachite for action, a glint of yellow, and one band of strata blue. The light theme is **Stone**; the dark theme is **Basalt**. Always use the tokens, never the hex values: the dark theme changes most of them.

- Put pages on `ground`. Put cards, inputs and editor panels on `surface`. Use `sandstone` for bands and table heads. Put code on `strata-soft`: inline code, commands and the path bar of a code block. Use `sidebar` only for the editor's navigation.
- Set text in `ink`. Use `ink-muted` for lead paragraphs and descriptions, and `ink-subtle` only for captions, placeholders and timestamps, never on `sandstone`.
- `primary` (Malachite) is the one action colour: primary buttons, links and the active navigation item. Give each view one primary button. Text on it is `on-primary`.
- `glint` is a highlight, never text and never a large area: the sparkle, the dot of the Not published status, a marker on what changed. Text on a glint fill is `on-glint`.
- `strata` (Strata blue) is for information and for the focus ring (`focus`). On the website it also colours the Astro rocket.
- `danger` (Hematite) is for errors, conflicts and actions that remove work. Never use it for decoration.
- Use the `*-soft` fills behind statuses and notices, with `ink` text.
- Keep `band-*` tokens for the strata illustration. They carry no meaning and have no contrast floor.
- Rough proportions on a website page: ground and ink most of it, sandstone for one or two bands, primary for actions and links, strata and glint as small accents.

## Type

- **Bricolage Grotesque** (`display` family) sets headlines on the website (`display`, `title-1`–`title-3`) and the page title in the docs. It has character; use it only for headlines. Not in the editor.
- **Instrument Sans** (`sans` family) sets all running text on every surface, and the whole editor (`editor-*` styles).
- **IBM Plex Mono** (`mono` family) sets what a computer reads: commands, paths, file contents and file trees (`code`, `code-small`). Never use it for decoration.
- Write headings in sentence case. Only `eyebrow` is uppercase, and only on the website.
- Keep running text between 60 and 75 characters a line.
- Load the three families from Google Fonts: Bricolage Grotesque (opsz 12–96, weights 500–800), Instrument Sans (400, 500, 600), IBM Plex Mono (400, 500).

## Logo

The logo keeps its current shapes: the lowercase **micacms** wordmark and the **m** in a rounded square. Only the colours follow this system. Never redraw them.

| File | What it is | Use it |
| --- | --- | --- |
| `sites/micacms/public/brand/micacms-wordmark.svg` | The wordmark in Shale (`ink`, #1C2522) | On `ground`, `surface` and `sandstone` |
| `sites/micacms/public/brand/micacms-wordmark-light.svg` | The wordmark in Stone (#F4F0E6) | On dark grounds, on `primary` and on photos |
| `sites/micacms/public/favicon.svg` | The **m** in Stone on a Malachite (`primary`) rounded square | The favicon, the app icon and the avatar, on any ground |

The editor has copies in `packages/editor-ui/public/brand/` (the icon is `micacms-favicon.svg`). Each file has one ink (the icon: two), so an `<img>` cannot recolour it: pick the file by its ground.

- Keep clear space around the wordmark of at least half its height. Do not set the wordmark smaller than 16px high on screen, or the icon smaller than 16px.
- Never redraw the logo, never set "mica" in Bricolage Grotesque as a logo, never add effects, outlines or a rocket to it, and never place it on a strata band.

## Motif: strata and glint

- **Strata** are four or five wavy horizontal bands (`band-glint`, `band-sand`, `band-malachite`, `band-blue`, `band-shale`, top to bottom). They stand for the layers that each publish adds. Use them at the foot of the hero and in the footer, with different wave shapes, so that the two do not look copied. Never in the editor, and never inside the text of the docs.
- **Glint** is a four-point sparkle in `glint`. It marks what is new or changed. Use two per view at most.
- **The rocket** is a small outline rocket in `strata` and `ink`. It is the wink to Astro: use it once per page at most, on the website only. It comes up from behind the hero's strata with a short trail of its past path, and flies on into space as the page scrolls.
- Draw shapes, not pictures: flat fills from the tokens, no gradients, no 3D, no mascot other than the rocket.

## Imagery

- The website works without photos. Real things make it better: screenshots of the real editor, real file trees, real diffs.
- Take screenshots from the example site, in the light theme, at 1x or 2x. Give them `radius-l`, a `line` border and no device frame, tilt or shadow.
- If you use a photo, show a real place or material (stone, paper, a desk) in natural light. No stock handshakes, no invented dashboards.

## Layout and spacing

- Build on the 4px scale: `space-1` to `space-9`. Separate website sections by `space-9` on desktop and `space-8` on phones. Keep the editor at `space-5` and below.
- Leave 20px between a heading and the text under it, and between paragraphs. Leave `space-7` (48px) above a heading in running text.
- Keep website content at 1120px wide at most, with a `space-4` gutter on phones.
- Use `radius-s` for inputs and code chips, `radius-m` for buttons, notices and editor panels, `radius-l` for website cards and screenshots, and `radius-pill` for status pills.
- Use borders before shadows: `line` for cards, `line-strong` for controls. Use `shadow-pop` only for menus, popovers and dialogs.
- Keep motion small: 150–200 ms, ease-out, no bounce. Respect reduced motion.
- The hero has the one larger moment: the strata rise into place from the bottom, the deepest layer first, and the rocket flies up to its resting point, about 2 s, once. When the page scrolls, the layers spread upward and the rocket flies on. With reduced motion, nothing moves. The footer strata never move.

## Iconography

- The editor uses **Lucide** icons at 16px or 20px, with a 1.75px stroke, in `ink` or `ink-muted`. The website uses the same set, sparingly.
- An icon always comes with a word, except in a toolbar where the button has an accessible name and a tooltip.
- No emoji in the product or on the website.

## Accessibility

- Every text pair meets WCAG 2.2 AA in both themes; each colour's note gives the numbers. Control borders (`line-strong`) and the focus ring meet 3:1.
- Show focus with a 2px solid `focus` ring and a 2px offset, on every surface.
- A status always carries a word, never only a colour.
- The editor targets WCAG 2.2 AA throughout. The website and the docs follow the same rule.

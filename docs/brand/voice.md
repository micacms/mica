# Voice and words

Mica speaks in one voice with three registers. The facts are the same everywhere; only the warmth changes.

## Three registers

| Register | Where | How | Example |
| --- | --- | --- | --- |
| Docs | Docs pages, READMEs, setup guides, CLI help | ASD-STE100 Simplified Technical English: short sentences, one instruction each, active voice, approved words | Run `npx mica check`. It checks each entry against the model. |
| Editor | Every word in the editor UI | Plain and a bit warm. Say what happened and what comes next. | Saved. It goes on the website when you publish. |
| Website | mica.build pages, release pages, social posts | Warmer, still short. A wink is allowed in a headline. | Your editors get forms. Your repository gets tidy commits. Nobody gets a database. |

## Humour

- Use it on the website, in headlines and empty states. One wink per page is enough.
- Aim it at the situation, or give Astro a friendly nod: *Astro reaches for the stars. Mica keeps your content down to earth.*
- Never joke in an error, a warning, a security page, anything about lost work, or a docs instruction.
- Never at the reader's cost, and never at another project's cost. Astro is a friend, not a target.

## Words

**In the editor**, use the editors' words, not Git's:

| Say | Do not say |
| --- | --- |
| Save, Saved | Commit, stage |
| Publish, Published | Push, deploy, merge |
| Not published yet | Uncommitted, dirty |
| Say what changed | Commit message |
| Changed on the website while you edited | Conflict, rejected push |
| Keep mine, Use theirs | Force, overwrite remote |
| Website | Repository, remote, branch |

**On the website and in the docs**, Git words are fine when the reader is a developer: *repository*, *commit*, *branch*.

**Avoid everywhere:** *simply*, *just*, *easy*, *seamless*, *blazing*, *revolutionary*, *powerful*, *headless* as a selling word, and exclamation marks.

## Grammar

- Sentence case for headings, buttons and menu items.
- Address the reader as *you*. Use *we* only for the maintainers.
- Buttons start with a verb and say what happens: *Publish 3 changes*, not *OK*.
- An error says what went wrong and what to do now. It never apologises and never blames.
- Use digits for numbers: *3 changes*, *1,000 entries*.
- Name things by what people see: *the Publish page*, not *the staging view*.

## Do and do not

| Do | Do not |
| --- | --- |
| Mica keeps your content as plain files in your Git repository. | Mica is a revolutionary Git-native headless CMS! |
| Saved · not published | Changes staged successfully. |
| This entry was changed on the website while you edited. | Error 409: revision mismatch. |
| Astro reaches for the stars. Mica stays down to earth. | Astro is too complicated, so we fixed it. |

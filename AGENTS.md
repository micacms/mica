# AGENTS.md

## Communication

- Always use ASD-STE100 Simplified Technical English.
- Keep answers clear and concise.
- State assumptions and important risks.

## Work method

- Make small, low-risk changes directly.
- Create a plan only when the user asks for one.
- Keep each change focused on the request.
- Follow the KISS principle and common conventions of FOSS projects.
- Prefer established patterns in this repository to new abstractions.
- Do not do browser tests unless the user asks for them.
- Change the content of `sites/micacms` and `examples/company-site` with the Mica MCP servers `mica-site` and `mica-example` (`.mcp.json`). They run the local build, so run `rush build` first.

## Approval required

Ask the user before you:

- Add or replace a production or development dependency.
- Make a breaking change to a public API, CLI, content format, or repository protocol.
- Take another action that can break compatibility or cause data loss.

## Architecture rules

- Git is the source of truth for website content.
- Mica keeps no database. Drafts that are not published yet are uncommitted files in a Git working tree. Mica must not store website history, sessions, accounts, or memberships.
- Do not add a content API, public media route, media server, or build webhook.
- Keep `@micacms/core` independent from Astro and other frameworks; its boundary test enforces this.
- Keep Node-only code out of browser bundles. Put Node-only model exports in the `@micacms/core/node` entry point.
- Treat `docs/architecture.md` and `docs/decisions.md` as design constraints.
- Do not manually edit generated files. Change their source and run the applicable generation process.

## Code style

- Use TypeScript strictness and the local style of the file that you edit.
- Keep functions and modules small and focused.
- Use clear names. Do not add an abstraction until it removes current duplication or isolates a real boundary.
- Keep comments on one line when practical.
- Add a comment only when it explains intent, a constraint, or a non-obvious decision.
- Use short JSDoc headers for reusable exported functions, interfaces, types, and classes when the name and type signature are not sufficient.
- Do not use comments to repeat the code.

## Tests and checks

- Add or update tests when behavior changes or a defect is fixed.
- Run the tests that are closest to the changed code during development.
- After a code change, run `rush typecheck` and `rush test` before completion.
- The tests and the typecheck of a package read the packages that it uses from their `dist` folders. After a change to a package that other packages use, run `rush build` before `rush typecheck` and `rush test`.
- Run `rush build` when a change can affect package output, the CMS bundle, an Astro site, packaging, or a release.
- Do not claim that a check passed if you did not run it.
- If a check cannot run, state the reason and the checks that remain.

## Voice and brand

- Read `docs/brand/voice.md` before you write text that people read, and use the register of the surface:
  - Docs, READMEs, setup guides and CLI help: ASD-STE100 Simplified Technical English.
  - Editor UI: plain and a bit warm, with editors' words and no Git words (Save, Publish, not commit, push).
  - Website copy, release pages on micacms.com and social posts: warmer, still short. At most one wink per page, never in errors, warnings or security text.
- Avoid the words that `voice.md` lists, such as "simply", "easy", "seamless" and "powerful", and exclamation marks.
- Follow `docs/brand/README.md` for colours, type, logo, motif, imagery and layout. Use the tokens, never hex values. The token values are in `docs/brand/tokens.json`.

## Documentation and releases

- Update related documentation when behavior, configuration, architecture, or a public API changes.
- Update `docs/decisions.md` when the change adds or changes an architectural decision, trade-off, known gap, or deferred item.
- Keep README files and examples consistent with the current behavior.
- Update `CHANGELOG.md` when a new version is created. Do not add routine unreleased changes unless the user asks for them.
- Record a change file with `rush change` when a change touches a published package; use the bump type `none` when the release notes should not mention it. Record a change to a private project for the published package that ships with it: `@micacms/editor-ui` for `@micacms/editor`, and `@micacms/auth-oidc`, `apps/self-hosted` and the `Dockerfile` (the image) for `@micacms/runtime`. `rush change --verify` does not find a missing change file for a private project, so check it yourself.
- Use `rush version-bump` to release the pending change files, or `rush release-version --version <version>` to set an explicit version. Do not edit package versions separately. The `/release` skill (`.claude/skills/release/`) walks the whole flow — bump choice, changelog section, verification.

## Subagents

The agents in `.claude/agents/` do recurring work. Use them where they fit:

- `validator` (Haiku): run the gates and report only failures — after a code change.
- `reviewer` (Opus): read-only review against these rules and the design docs — before a commit or a PR.
- `docs-keeper` (Sonnet): fix documentation that disagrees with the code.
- `site-keeper` (Sonnet): update `sites/micacms` and `examples/company-site` after a release or a relevant change.
- `release-prep` (Sonnet): prepare a release in the background. It never commits, tags or pushes; the `/release` skill stays the interactive flow.

## Git and pull requests

- Do not commit, tag, push, or create a pull request unless the user asks.
- When the user asks for a branch, create it from an up-to-date `main` branch.
- Use one of these branch prefixes: `docs/`, `feature/`, `chore/`, `bugfix/`, `refactor/`, or `content/`.
- Use a short, descriptive branch name after the prefix.
- Keep commit messages to one concise line. Do not add AI co-authoring information to commit messages or pull requests.
- Keep each commit focused on one logical change.
- Structure a pull request description in this order:
  1. `Description`
  2. Applicable change sections: `Features`, `Improvements`, `Bugfixes`, `Refactors`, and `Docs`
- Under each applicable change section, use a bullet list with short change descriptions and the affected packages, like: "- Fix issue with user authentication (`@micacms/package-name`)".
- Omit empty change sections.

## Repository map

- `packages/core`: content model, field DSL, validation, serialization, authoring format, and the port contracts.
- `packages/astro`: Astro Content Layer integration and Markdoc rendering, and the setup guides for coding agents (`setup/`), which ship with the package.
- `packages/runtime`: the authentication-neutral single-site Hono API and services, the working tree's files, and Git on that tree.
- `packages/editor-ui`: the Vue administration SPA, shipped as built assets.
- `packages/auth/oidc`: the server-only OIDC gate (`@micacms/auth-oidc`). Never a dependency of the local editor.
- `apps/local-editor`: the `npx @micacms/editor` composition — loopback, no auth, no database.
- `apps/self-hosted`: the Docker composition — runtime and UI behind OIDC, on a Git clone that it keeps, syncs and pushes itself.
- `sites/micacms`: public Mica website, and the canonical user documentation (`content/docs`).
- `examples/company-site`: example website and evolving reference project.
- `examples/starter`: the minimal starter for `npm create astro -- --template micacms/mica/examples/starter`. It installs the published packages, so it is not a Rush project; each release sets its versions.
- `SETUP.md`: the entry point for a coding agent that sets up Mica in a user's project, served at `micacms.com/setup.md`. Keep it valid for every version; version-specific steps go in `packages/astro/setup/`.
- `docs`: architecture and decision documentation for contributors, and the brand book (`docs/brand`). The user guides move to `sites/micacms` (#117).
- `deploy/self-hosted`: the reference deployment — the Compose file and its `.env.example`.
- `deploy/demo-identity`: the demo stack with ZITADEL.
- `tests/e2e`: manual deployed-shape environment with Keycloak. Do not treat it as an automated browser test suite.
- `tests/oidc`: automated OIDC round trip — the real image against Dex and a Forgejo Git host, run by CI. No browser.
- `tests/browser`: automated browser test — Playwright drives the editor UI on the `tests/oidc` stack, run by CI.

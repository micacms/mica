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

## Approval required

Ask the user before you:

- Add or replace a production or development dependency.
- Create or apply a database migration.
- Make a breaking change to a public API, CLI, content format, database schema, or repository protocol.
- Change `sites/muster-consulting`, `sites/micacms` or its contents.
- Take another action that can break compatibility or cause data loss.

## Architecture rules

- Git is the source of truth for website content.
- The SQLite database holds browser sessions, and later the drafts that are not published yet. It must not hold website content, accounts, or memberships.
- Do not add a content API, public media route, media server, or build webhook.
- Keep `@micacms/model` independent from Astro and other frameworks.
- Keep Node-only code out of browser bundles. Put Node-only model exports in the `@micacms/model/node` entry point.
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
- After a code change, run `pnpm typecheck` and `pnpm test` before completion.
- Run `pnpm build` when a change can affect package output, the CMS bundle, an Astro site, packaging, or a release.
- Do not claim that a check passed if you did not run it.
- If a check cannot run, state the reason and the checks that remain.

## Documentation and releases

- Update related documentation when behavior, configuration, architecture, or a public API changes.
- Update `docs/decisions.md` when the change adds or changes an architectural decision, trade-off, known gap, or deferred item.
- Keep README files and examples consistent with the current behavior.
- Update `CHANGELOG.md` when a new version is created. Do not add routine unreleased changes unless the user asks for them.
- Use `pnpm release:version <version>` for version changes. Do not edit package versions separately.

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

- `packages/model`: content model, field DSL, validation, serialization, and authoring format.
- `packages/connectors`: local, GitHub, and GitLab repository access.
- `packages/astro`: Astro Content Layer integration and Markdoc rendering.
- `packages/editor`: Hono server and Vue administration application.
- `sites/micacms`: public Mica website.
- `sites/muster-consulting`: example website and evolving reference project.
- `docs`: product, architecture, setup, and decision documentation.
- `e2e`: manual deployed-shape environment with Keycloak. Do not treat it as an automated browser test suite.

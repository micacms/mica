# Contributing to Mica

Thank you for your help. Mica is maintained by one person on a best-effort
basis, so a small, focused change is the fastest to review. See
[GOVERNANCE.md](GOVERNANCE.md).

## Before you start

- For a bug, open an issue with the form. For a vulnerability, follow
  [SECURITY.md](SECURITY.md) and do not open a public issue.
- For a large change or a new feature, open an issue first, so that we agree
  on the design before you write code.
- Read [AGENTS.md](AGENTS.md). It holds the rules for this repository, for
  people and for coding agents: the architecture rules, the code style, the
  tests, and how to write documentation (ASD-STE100 Simplified Technical
  English).
- The design and its reasons are in [docs/architecture.md](docs/architecture.md)
  and the decision records in [docs/adr/](docs/adr/README.md).

## Set up

You need Node.js 24 or later and Git. The repository is a
[Rush](https://rushjs.io) monorepo. Rush installs its own pinned pnpm.

```bash
npm install --global @microsoft/rush
rush install
rush build
```

Without a global Rush, use `node common/scripts/install-run-rush.js` in place
of `rush`.

| Command | What it does |
| --- | --- |
| `rush dev` | Builds the packages, then runs the editor on the example site. |
| `rush typecheck` | Checks the types of every package, `.vue` and `.astro` included. |
| `rush test` | Runs the tests of every package, with real Git on temporary repositories. |
| `rush build` | Builds every package, the example and the website. |
| `node scripts/pack-test.mjs` | Builds and packs the published packages, installs them in a copy of the starter, and runs `mica check`, `astro build` and `mica start` there. It needs the network. |

The tests run on the source of their package, so a test run builds nothing.
The tests and the typecheck read the other packages from their build output:
after a change to a package that others use, run `rush build` first.

The browser tests of the self-hosted editor need Docker. The browser test of
the local editor needs only `rush build`. See
[tests/browser/README.md](tests/browser/README.md).

## Make a change

1. Make a branch from an up-to-date `main`. Use one of these prefixes:
   `feature/`, `bugfix/`, `docs/`, `chore/`, `refactor/` or `content/`.
2. Keep the change focused. Add or change tests when behaviour changes.
3. Run `rush build`, `rush typecheck` and `rush test`. All must pass.
   `rush build` also writes the API report of each public entry point of
   `@micacms/core` and `@micacms/astro` (`packages/*/api/*.api.md`). If a
   report changes, commit it with your change, and say in the pull request
   why the public API changes. In CI, the build fails when a report is not
   the built API.
4. If you changed a published package (`packages/*`, `apps/local-editor`),
   run `rush change` and describe the change for the release notes. Use the
   bump type `none` when the release notes should not mention it. A change to
   the editor UI goes on `@micacms/editor`. A change to the OIDC gate or to the
   image (`apps/self-hosted`, `Dockerfile`) goes on `@micacms/runtime`. CI does
   not find a missing change file for these.
5. Update the documentation that your change makes wrong. The user guides are
   on the website, in `sites/website/content/docs`. The contributor docs are in
   `docs/`.

Write each commit message as one short line that says what changed.

## Open a pull request

The pull-request template lists the sections: a description, then features,
improvements, bug fixes, refactors and docs, each with the affected packages.
CI runs the same checks as above, the OIDC test and the browser tests.

## Licence

Mica is MIT-licensed. By contributing, you agree that your contribution is
under the same licence.

## Code of conduct

Everybody who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).

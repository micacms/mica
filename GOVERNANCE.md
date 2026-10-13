# Governance

## The maintainer

Mica is a hobby project of one maintainer, Alexander Müdespacher
([@amuedespacher](https://github.com/amuedespacher)). Much of the code is
written with AI-assisted coding. The maintainer reviews each change, and CI
runs the tests, the type checks and the browser tests on each pull request.

## What you can expect

- **Best effort.** There are no response times for issues, pull requests or
  security reports.
- **Fixes go into the latest release only.** See [SECURITY.md](SECURITY.md).
- **Versions.** From 1.0, semantic versioning covers the public surface:
  `@micacms/core`, `@micacms/astro`, the `@micacms/editor` command line, the
  contract of the self-hosted image, the content format and the manifest. The
  other packages are internal. Before 1.0, a minor version can break the
  public surface; the changelog says how. The decision "Semver covers the
  public surface" in [docs/decisions.md](docs/decisions.md) has the details.

## How decisions are made

The maintainer decides. The design rules and the reasons for them are in
[docs/architecture.md](docs/architecture.md) and
[docs/decisions.md](docs/decisions.md). A change that goes against a decision
starts with an issue that proposes to change the decision. For a large change,
open an issue before you write code. See [CONTRIBUTING.md](CONTRIBUTING.md).

## If the maintainer stops

There is one maintainer, and there is no search for a second one before 1.0.
If the maintainer stops, the code stays MIT-licensed, and anyone can fork it.
Your website does not depend on Mica to run: the content is JSON, Markdoc and
media files in your own Git repository, and your build reads them without
Mica.

## What stays open source

Everything in this repository is MIT-licensed and stays so: the content model,
the Astro integration, the editor, the runtime, the local editor and the
self-hosted image. The open-source edition is a complete product for one site
for each running Mica. It is not a demo, and not a reduced client of a paid
service.

## Mica Cloud

A later, private product can use stable releases of the open-source Mica: the
administration of many sites, managed sign-in, roles and operations. It would
run one separate Mica for each site, made from the published releases. It is
not in this repository, and features of the open-source Mica do not move into
it. There is no date for it, and no promise that it will exist.

# Changesets

A change that should reach a release carries a changeset — a small file here
that names the packages it touches and says what changed. Add one with:

```bash
pnpm changeset
```

Every published package is in one `fixed` group, so any bump moves all of them
to the same next version: Mica releases as one thing, whatever the entry in the
version report says. The private packages — the websites under `sites/` and
`examples/` — are never versioned or published.

CI runs `changeset status` against `main`: a pull request that changes a
published package without carrying a changeset fails there. A change that
should *not* reach the release notes (refactors, CI, docs) still needs the
file — create an empty one with `pnpm changeset --empty`.

Releasing stays the two-step it was: `pnpm changeset:version` consumes the
changesets and writes the one lockstep version everywhere — the manifests
through Changesets, then the root manifest and the image tag in
`deploy/self-hosted/compose.yml` through `scripts/version.mjs` — and pushing
the tag publishes. See `.github/workflows/release.yml`.

# 31. Support: current platforms, and fixes for the latest minor only

**Status:** Accepted

## Context

One maintainer, one lockstep version and one branch. Only what CI tests is supported.

## Decision

- Mica supports Node.js 24 or later and Astro 7 (peer range `^7.0.0`). The `engines` fields, `rush.json` and the CI matrix say the same. Mica removes a Node line in a minor release after its end of life, and the minor before announces it. A new Astro major comes in a minor when CI covers it; removing an Astro major is a Mica major.
- The local editor supports Linux, macOS and Windows. The image is for `linux/amd64` and `linux/arm64`. Its build refuses a native module, so each server dependency must be plain JavaScript.
- Fixes, security fixes included, go into the next release of the latest 1.x minor. An earlier minor gets none: the upgrade in 1.x is the fix.
- 0.x ends when 1.0 ships. Before 1.0, a change to the content format, the manifest or an API comes with no migration: no command, no converter and no reader for the old shape.

## Consequences

- A site on an older Node or Astro stays on an older Mica.
- An adopter who cannot take a minor gets no security fix.
- Change this decision when: a second maintainer joins, or adopters need a fixed support window. Then fix the previous minor on a release branch.

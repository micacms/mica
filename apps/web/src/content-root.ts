/**
 * Where this project's content lives.
 *
 * One constant, because three things need to agree on it: the collections in
 * `content.config.ts`, the `mica()` integration in `astro.config.mjs`, and the
 * image resolution in `lib/images.ts`. A disagreement between them produces an
 * empty build rather than an error, which is the worst kind of failure.
 *
 * Relative to the repository root rather than to `apps/web`, because this is a
 * single-repository project: the content sits beside the Astro app, not inside
 * it. A project whose content has its own repository would point this at
 * wherever CI puts the checkout.
 */

import { fileURLToPath } from "node:url";

export const CONTENT_ROOT = fileURLToPath(new URL("../../../content", import.meta.url));

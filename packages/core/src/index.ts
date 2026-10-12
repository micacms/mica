/**
 * @micacms/core — the shared content domain and its port contracts.
 *
 * Deliberately framework-independent: nothing here imports Astro, Vue, Hono,
 * an auth implementation, a provider SDK or a storage driver, and nothing here
 * touches a filesystem or a network. The Astro integration, the Mica runtime,
 * the editor UI and every adapter consume this package, which is what keeps
 * one schema — and one on-disk format — authoritative. The boundary test
 * beside this package asserts the rule.
 *
 *   types/fields/define  the DSL: what a site may declare
 *   validation/defaults  what a payload must satisfy
 *   layout               where a payload lives in the repository
 *   serialize/parse      how it is written there and read back
 *   protocol             how a project describes itself to Mica
 *   source/read          how a content directory is discovered and loaded
 *   staging              what sits between saved and published
 *   access               who a request acts as, however an app decided that
 *
 * `fileSystemSource` is not here. It is in `@micacms/core/node`, because this
 * entry point is bundled into the editor and must stay free of `node:` imports.
 */

export * from "./types.js";
export * from "./fields.js";
export * from "./define.js";
export * from "./validation.js";
export * from "./defaults.js";
export * from "./slugify.js";
export * from "./layout.js";
export * from "./serialize.js";
export * from "./parse.js";
export * from "./protocol.js";
export * from "./source.js";
export * from "./read.js";
export * from "./staging.js";
export * from "./access.js";

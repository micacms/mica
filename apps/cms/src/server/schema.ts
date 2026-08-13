/**
 * Acquiring the content model at runtime.
 *
 * The server ships with no model of its own. It is handed one at boot, which is
 * what lets a single published image serve any project: the schema is plain
 * data (field descriptors hold no functions, so `JSON.stringify(site)`
 * round-trips), and every consumer downstream — form generation, payload
 * validation, the public API — already reads it out of the request context.
 *
 * Two shapes are accepted, because self-hosting and a hosted service want
 * different things:
 *
 *   - a compiled ES module, whose default export is the model. This is what
 *     `pnpm build:schema` produces from `mica.config.ts`, and what an operator
 *     mounts into the container.
 *   - a `.json` file, which is the same object after a round-trip. This is the
 *     shape a `mica push` would send, so accepting it now keeps that door open.
 *
 * Whatever arrives is re-validated as if it had just been written by hand.
 * A schema from disk is untrusted input: it may have been produced by a
 * different version of `@micacms/model`, hand-edited, or truncated.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { defineSite, isFieldKind, type Collection, type FieldMap, type Singleton, type Site } from "@micacms/model";

export class SchemaError extends Error {
  override name = "SchemaError";
}

const MODULE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts"]);

/**
 * Reads the model named by `source` and returns it ready to serve.
 *
 * `source` is a filesystem path. Relative paths resolve against the working
 * directory, which is `/app/apps/cms` in the image and the package root under
 * `pnpm dev` — so callers should prefer absolute paths.
 */
export async function loadSchema(source: string): Promise<Site> {
  const resolved = path.resolve(source);
  const extension = path.extname(resolved).toLowerCase();

  const raw =
    extension === ".json" ? await readJsonSchema(resolved) : await importSchema(resolved, extension);

  return checkSchema(raw, resolved);
}

async function readJsonSchema(resolved: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(resolved, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SchemaError(describeMissing(resolved));
    }
    throw new SchemaError(`Could not read the schema at ${resolved}: ${(error as Error).message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SchemaError(`Schema at ${resolved} is not valid JSON: ${(error as Error).message}`);
  }
}

async function importSchema(resolved: string, extension: string): Promise<unknown> {
  if (!MODULE_EXTENSIONS.has(extension)) {
    throw new SchemaError(
      `Schema at ${resolved} has an unsupported extension "${extension || "(none)"}". ` +
        `Expected a compiled module (.js) or .json.`,
    );
  }

  // Whether the model file itself is missing is settled before importing,
  // because `ERR_MODULE_NOT_FOUND` is also what an unresolvable import *inside*
  // the file raises. Reporting "no content model here" for a config that exists
  // but cannot find `@micacms/model` sends the reader to the wrong problem.
  const present = await stat(resolved).then(
    (entry) => entry.isFile(),
    () => false,
  );
  if (!present) throw new SchemaError(describeMissing(resolved));

  let module: Record<string, unknown>;
  try {
    // A cache-busting query would defeat the module cache on reload; there is
    // no reload today, so the plain URL keeps stack traces readable.
    module = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  } catch (error) {
    const reason = (error as Error).message;
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      throw new SchemaError(
        `The content model at ${resolved} could not be loaded — one of its own imports is missing.\n` +
          `  ${reason}\n` +
          `  A compiled model must sit where its imports resolve. Prefer the JSON that\n` +
          `  \`pnpm build:schema\` produces, which has no imports at all.`,
      );
    }
    throw new SchemaError(`The content model at ${resolved} threw while loading:\n  ${reason}`);
  }

  const model = module["default"] ?? module["site"];
  if (model === undefined) {
    throw new SchemaError(
      `Schema at ${resolved} exports neither a default nor a \`site\` binding.\n` +
        `  Expected:  export default defineSite({ ... })`,
    );
  }
  return model;
}

function describeMissing(resolved: string): string {
  return (
    `No content model at ${resolved}.\n` +
    `  MICA_SCHEMA must point at a compiled model — build one with \`pnpm build:schema\`,\n` +
    `  and mount it into the container if you are running the published image.`
  );
}

/**
 * Re-runs the checks `defineSite` performs on a hand-written model, plus the
 * one it does not: that every `kind` is a kind this build knows about.
 *
 * `defineSite` assumes its input came from the typed builders, so it never
 * questions a `kind`. Field kinds reach a `switch` with no default when a form
 * is rendered and when a payload is validated, so an unknown one surfaces as an
 * incoherent failure much later, on an editor's screen. Catching it here turns
 * a version mismatch between the project's `@micacms/model` and the image's
 * into a startup error that names the field.
 */
export function checkSchema(raw: unknown, origin = "the schema"): Site {
  if (raw === null || typeof raw !== "object") {
    throw new SchemaError(`${origin} is ${raw === null ? "null" : typeof raw}, expected an object.`);
  }

  const candidate = raw as { collections?: unknown; singletons?: unknown; globals?: unknown };

  if (candidate.collections === null || typeof candidate.collections !== "object") {
    throw new SchemaError(`${origin} has no \`collections\`. Expected defineSite({ collections: { ... } }).`);
  }

  // `globals` was the term before the model settled on `singletons`. A compiled
  // schema outlives the release that produced it, so both spellings are read
  // here; only the new one is written anywhere.
  const rawSingletons = candidate.singletons ?? candidate.globals;
  if (rawSingletons !== undefined && (rawSingletons === null || typeof rawSingletons !== "object")) {
    throw new SchemaError(`${origin} has a \`singletons\` that is not an object.`);
  }

  const collections = candidate.collections as Record<string, Collection>;
  const singletons = (rawSingletons ?? {}) as Record<string, Singleton>;

  for (const [name, def] of Object.entries(collections)) {
    assertFieldMap(def?.fields, `collections.${name}`, origin);
  }
  for (const [name, def] of Object.entries(singletons)) {
    assertFieldMap(def?.fields, `singletons.${name}`, origin);
  }

  // Name injection and every cross-reference check — unknown relation targets,
  // slugs derived from absent siblings, reserved collection names — come from
  // the same function a hand-written model goes through.
  try {
    return defineSite({ collections, singletons });
  } catch (error) {
    throw new SchemaError(`${origin} is not a valid content model.\n  ${(error as Error).message}`);
  }
}

function assertFieldMap(fields: unknown, at: string, origin: string): void {
  if (fields === null || typeof fields !== "object") {
    throw new SchemaError(`${origin}: "${at}" has no \`fields\` object.`);
  }

  for (const [key, field] of Object.entries(fields as FieldMap)) {
    const here = `${at}.${key}`;

    if (field === null || typeof field !== "object") {
      throw new SchemaError(`${origin}: field "${here}" is not an object.`);
    }
    if (!isFieldKind(field.kind)) {
      throw new SchemaError(
        `${origin}: field "${here}" has unknown kind "${String(field.kind)}".\n` +
          `  This build of Mica does not support it — the project may have been built\n` +
          `  against a newer @micacms/model than the server is running.`,
      );
    }
    if (field.kind === "object" || field.kind === "repeater") {
      assertFieldMap(field.fields, here, origin);
    }
  }
}

/**
 * A stable short digest of a model, for spotting drift.
 *
 * Logged at startup and returned by the schema endpoint so that a website built
 * against one model and a CMS serving another is a visible mismatch rather than
 * a puzzling absence of fields. Key order follows the model's own declaration
 * order, which is meaningful here — reordering fields reorders the admin form,
 * so it is a real change and should produce a different digest.
 */
export async function schemaFingerprint(site: Site): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(site)).digest("hex").slice(0, 12);
}

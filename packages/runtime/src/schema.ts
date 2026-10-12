/**
 * Reads the content model from `.mica/schema.json` in the content repository.
 * The Astro project writes it. The manifest is untrusted input (another core
 * version, hand-edited or truncated), so it is validated again here.
 */

import {
  checkCompatibility,
  defineSite,
  isFieldKind,
  isProtocolManifest,
  MANIFEST_PATH,
  PROTOCOL_VERSION,
  type Collection,
  type ContentSource,
  type FieldMap,
  type Singleton,
  type Site,
} from "@micacms/core";

export class SchemaError extends Error {
  override name = "SchemaError";
}

/** Where a model came from, for logs and the system screen. */
export function schemaOrigin(source: ContentSource): string {
  return `${source.origin}/${MANIFEST_PATH}`;
}

/**
 * Reads the model from the content repository. A missing file gets a long
 * message because a first deployment hits it.
 */
export async function loadSchema(source: ContentSource): Promise<Site> {
  const origin = schemaOrigin(source);

  let text: string | null;
  try {
    text = await source.read(MANIFEST_PATH);
  } catch (error) {
    // An unreachable repository is not a bad model; the fixes are different.
    throw new SchemaError(
      `Could not read the content model from ${source.origin}.\n` +
        `  ${(error as Error).message}\n` +
        `  The repository has to be reachable before Mica can start: the model\n` +
        `  lives in it, at ${MANIFEST_PATH}.`,
    );
  }

  if (text === null) throw new SchemaError(describeMissing(origin));

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new SchemaError(`${origin} is not valid JSON: ${(error as Error).message}`);
  }

  return checkSchema(raw, origin);
}

function describeMissing(origin: string): string {
  return (
    `No content model at ${origin}.\n` +
    `  Mica ships without one — the Astro project defines it and writes it here.\n` +
    `  In the project:  npx astro build   (or start the dev server once)\n` +
    `  then commit ${MANIFEST_PATH} and push it to the branch Mica is reading.`
  );
}

/**
 * Runs the `defineSite` checks, and also refuses an unknown field `kind`, which
 * `defineSite` does not check. This turns a core version mismatch into a
 * startup error, not a later failure on an editor's screen.
 */
export function checkSchema(raw: unknown, origin = "the schema"): Site {
  if (raw === null || typeof raw !== "object") {
    throw new SchemaError(`${origin} is ${raw === null ? "null" : typeof raw}, expected an object.`);
  }

  // A bare `{ collections }` without the protocol envelope is also accepted.
  if (isProtocolManifest(raw)) {
    const compatibility = checkCompatibility(raw);
    if (!compatibility.ok && compatibility.reason === "newer") {
      throw new SchemaError(
        `${origin} follows protocol version ${compatibility.version}; this build of Mica ` +
          `understands version ${PROTOCOL_VERSION}.\n` +
          `  The project was built against a newer @micacms/astro. Upgrade Mica.`,
      );
    }
  }

  const candidate = raw as { collections?: unknown; singletons?: unknown };

  if (candidate.collections === null || typeof candidate.collections !== "object") {
    throw new SchemaError(`${origin} has no \`collections\`. Expected defineSite({ collections: { ... } }).`);
  }

  const rawSingletons = candidate.singletons;
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

  // Drop, do not refuse, a default sort on an undeclared field: only the list order is affected.
  for (const def of Object.values(collections)) {
    const field = def?.defaultSort?.field;
    if (field && field !== "position" && !def.fields?.[field]) delete def.defaultSort;
  }

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
          `  against a newer @micacms/astro than the server is running.`,
      );
    }
    if (field.kind === "object" || field.kind === "repeater") {
      assertFieldMap(field.fields, here, origin);
    }
  }
}

/**
 * A short digest of a model, to show drift. Field order counts, because it is
 * the order of the admin form.
 */
export async function schemaFingerprint(site: Site): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(site)).digest("hex").slice(0, 12);
}

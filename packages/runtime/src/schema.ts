/**
 * Reads the content model from `.mica/schema.json` in the content repository.
 * The Astro project writes it; core's `readManifest` checks it.
 */

import { type ContentSource, MANIFEST_PATH, ManifestError, readManifest, type Site } from "@micacms/core/internal";

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

  try {
    return readManifest(raw, origin).site;
  } catch (error) {
    if (error instanceof ManifestError) throw new SchemaError(error.message);
    throw error;
  }
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
 * A short digest of a model, to show drift. Field order counts, because it is
 * the order of the admin form.
 */
export async function schemaFingerprint(site: Site): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(site)).digest("hex").slice(0, 12);
}

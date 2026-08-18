/**
 * Acquiring the content model at runtime.
 *
 * The server ships with no model of its own. It reads one out of the content
 * repository, at `.mica/schema.json`, through the same connector it reads
 * entries with. The Astro project writes that file and the developer commits
 * it, so the model reaches the server the way content does — no artifact to
 * mount, no second channel to keep in step, and a model change that is
 * reviewable in a diff.
 *
 * That is what lets one published image serve any project: the model is plain
 * data (field descriptors hold no functions, so `JSON.stringify(site)`
 * round-trips), and every consumer downstream — form generation, payload
 * validation, the admin — already reads it out of the request context.
 *
 * Whatever arrives is re-validated as if it had just been written by hand. A
 * manifest from a repository is untrusted input: it may have been produced by a
 * different version of `@micacms/model`, hand-edited, or truncated.
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
} from "@micacms/model";

export class SchemaError extends Error {
  override name = "SchemaError";
}

/** Where a model came from, for logs and the system screen. */
export function schemaOrigin(source: ContentSource): string {
  return `${source.origin}/${MANIFEST_PATH}`;
}

/**
 * Reads the model the content repository publishes.
 *
 * A missing file is the interesting failure and gets the long message: it is
 * what a first deployment hits, and the fix — build the Astro project, commit
 * the result — is not guessable from "not found".
 */
export async function loadSchema(source: ContentSource): Promise<Site> {
  const origin = schemaOrigin(source);

  let text: string | null;
  try {
    text = await source.read(MANIFEST_PATH);
  } catch (error) {
    // A repository that cannot be reached is not a bad model. Say which it is,
    // because the two have completely different fixes.
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

  // Only when the envelope says so. A bare `{ collections }` is still accepted:
  // the protocol version is a backstop for changes that cannot be detected by
  // looking, not an admission ticket.
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

  const candidate = raw as { collections?: unknown; singletons?: unknown; globals?: unknown };

  if (candidate.collections === null || typeof candidate.collections !== "object") {
    throw new SchemaError(`${origin} has no \`collections\`. Expected defineSite({ collections: { ... } }).`);
  }

  // `globals` was the term before the model settled on `singletons`. A manifest
  // outlives the release that produced it, so both spellings are read here;
  // only the new one is written anywhere.
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

  /**
   * A default sort naming a field the collection does not declare is dropped
   * here rather than refused.
   *
   * `defineSite` rejects it, which is right when somebody is writing the model
   * and can fix the line they are looking at. By the time it reaches Mica the
   * model is committed and a site is starting against it: the entries are
   * intact, the fields are intact, and the only casualty is the order of a
   * list. Refusing to serve the site over that would be out of proportion —
   * and models written before the check existed contain exactly this, because
   * the old fixed list of sort fields offered names no collection had.
   *
   * So the option is dropped, the list falls back to the order editors
   * arranged by hand, and the project's next build reports it properly.
   */
  for (const def of Object.values(collections)) {
    const field = def?.defaultSort?.field;
    if (field && field !== "position" && !def.fields?.[field]) delete def.defaultSort;
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
          `  against a newer @micacms/astro than the server is running.`,
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

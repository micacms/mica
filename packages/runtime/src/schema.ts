/**
 * Reads the content model from `.mica/schema.json` in the content repository.
 * The Astro project writes it. The manifest is untrusted input (another core
 * version, hand-edited or truncated), so it is validated again here.
 */

import {
  checkCompatibility,
  defineSite,
  deriveLayout,
  entryLayout,
  LayoutError,
  misplacedFiles,
  recordLayout,
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

/**
 * One message for each collection or singleton with entries in the other
 * layout. Mica refuses to start on any: editing next to hidden entries would
 * let a save create a second copy of a page.
 */
export async function layoutProblems(source: ContentSource, site: Site): Promise<string[]> {
  const problems: string[] = [];
  const parts = [
    ...Object.entries(site.collections).map(([name, def]) => [name, def.fields, "collection"] as const),
    ...Object.entries(site.singletons).map(([name, def]) => [name, def.fields, "singleton"] as const),
  ];
  for (const [name, fields, kind] of parts) {
    const paths = await misplacedFiles(source, fields, name, kind);
    if (paths.length > 0) problems.push(new LayoutError(paths, name, entryLayout(fields)).message);
  }
  return problems;
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
 * Runs the `defineSite` checks on untrusted input. A newer `protocolVersion` is
 * refused; an unknown field kind is not, and `readOnlyParts` names what it locks.
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
    const site = defineSite({ collections, singletons });
    // Read and classify entries where the manifest says they are, not where fields this build may not know imply.
    for (const def of [...Object.values(site.collections), ...Object.values(site.singletons)]) {
      const stored = (def as { layout?: unknown }).layout;
      if (stored === "file" || stored === "directory") recordLayout(def.fields, stored);
    }
    return site;
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
    if (field.kind === "object" || field.kind === "repeater") {
      assertFieldMap(field.fields, here, origin);
    }
  }
}

/**
 * The collections and singletons this build of Mica must not write, keyed
 * `collections.<name>` or `singletons.<name>`, with the reason for the editor.
 * A field kind from a newer @micacms/astro makes only its own collection or
 * singleton read-only; Mica still starts, and the rest stays editable.
 */
export function readOnlyParts(site: Site): Map<string, string> {
  const parts = new Map<string, string>();
  const add = (key: string, def: Collection | Singleton) => {
    const unknown = unknownKinds(def.fields, []);
    const stored = (def as { layout?: unknown }).layout;
    if (unknown.length > 0) {
      parts.set(
        key,
        `"${def.label}" uses ${unknown.map((field) => `"${field.path}" (${field.kind})`).join(", ")}, ` +
          "a field type that this version of Mica does not know. Upgrade Mica to edit it.",
      );
    } else if (stored !== undefined && stored !== deriveLayout(def.fields)) {
      parts.set(
        key,
        `"${def.label}" is stored as ${String(stored)}, which this version of Mica does not expect. ` +
          "Upgrade Mica to edit it.",
      );
    }
  };
  for (const [name, def] of Object.entries(site.collections)) add(`collections.${name}`, def);
  for (const [name, def] of Object.entries(site.singletons)) add(`singletons.${name}`, def);
  return parts;
}

function unknownKinds(fields: FieldMap, at: string[]): Array<{ path: string; kind: string }> {
  return Object.entries(fields).flatMap(([key, field]) => {
    const here = [...at, key];
    if (!isFieldKind(field.kind)) return [{ path: here.join("."), kind: String(field.kind) }];
    return field.kind === "object" || field.kind === "repeater" ? unknownKinds(field.fields, here) : [];
  });
}

/**
 * A short digest of a model, to show drift. Field order counts, because it is
 * the order of the admin form.
 */
export async function schemaFingerprint(site: Site): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(site)).digest("hex").slice(0, 12);
}

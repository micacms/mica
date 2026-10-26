/**
 * Reading a manifest: the counterpart of `createManifest`. The manifest is
 * untrusted input — another core version, hand-edited or truncated — so every
 * reader checks it here, the same way: the self-hosted and the local editor,
 * and `mica check`.
 */

import { defineSite, labelProblem } from "./define.js";
import { COMMON_OPTIONS, FIELD_OPTIONS, isFieldKind } from "./fields.js";
import { isMediaFileType } from "./media-types.js";
import { pageUrlProblem } from "./page-url.js";
import { checkCompatibility, isProtocolManifest, PROTOCOL_VERSION } from "./protocol.js";
import { RICH_TEXT_TOOLBARS } from "./rich-text.js";
import type { Collection, FieldMap, Singleton, Site } from "./types.js";

export class ManifestError extends Error {
  override name = "ManifestError";
}

export interface ReadManifest {
  site: Site;
  /** From `readOnlyParts`: the collections and singletons this build must not write, with the reason. */
  readOnly: Map<string, string>;
  /** What the reader left out because only the editor's buttons or a list order depend on it. */
  warnings: string[];
}

/**
 * Checks a manifest and returns its model. A newer `protocolVersion` is
 * refused. A field kind or an option that this build does not know is not: it
 * makes its collection or singleton read-only (`readOnlyParts`).
 */
export function readManifest(raw: unknown, origin = "the manifest"): ReadManifest {
  if (!isProtocolManifest(raw)) {
    throw new ManifestError(`${origin} is not a Mica manifest: it needs \`protocolVersion\`, \`generatedBy\`, \`collections\` and \`singletons\`.`);
  }
  const compatibility = checkCompatibility(raw);
  if (!compatibility.ok && compatibility.reason === "newer") {
    throw new ManifestError(
      `${origin} follows protocol version ${compatibility.version}; this build of Mica ` +
        `understands version ${PROTOCOL_VERSION}.\n` +
        `  The project was built against a newer @micacms/astro. Upgrade Mica.`,
    );
  }

  const collections = raw.collections as Record<string, Collection>;
  const singletons = raw.singletons as Record<string, Singleton>;
  for (const [name, def] of Object.entries(collections)) assertFieldMap(def?.fields, `collections.${name}`, origin);
  for (const [name, def] of Object.entries(singletons)) assertFieldMap(def?.fields, `singletons.${name}`, origin);

  const warnings: string[] = [];
  // Left out, not refused: only the list order depends on it.
  for (const [name, def] of Object.entries(collections)) {
    const field = def.defaultSort?.field;
    if (field && field !== "position" && !def.fields[field]) {
      warnings.push(`"${name}" sorts by "${field}", which is not a field. The list keeps its manual order.`);
      delete def.defaultSort;
    }
  }
  // Left out, not refused: only a link in the editor depends on it.
  for (const [kind, defs] of [["collection", collections], ["singleton", singletons]] as const) {
    for (const [name, def] of Object.entries(defs)) {
      if (def.url === undefined || !pageUrlProblem(def.url, kind, def.fields)) continue;
      warnings.push(`"${name}" has the url "${String(def.url)}", which this version of Mica cannot read. The editor shows no link to its page.`);
      delete def.url;
    }
  }
  // Left out, not refused: only the editor's buttons depend on it.
  for (const [name, def] of [...Object.entries(collections), ...Object.entries(singletons)]) {
    for (const path of knownToolbars(def.fields, [])) warnings.push(`"${name}.${path}" has toolbar features that this version of Mica does not know.`);
  }

  // Left out, but read-only: a newer file type changes what a field can store.
  const unknownTypes = new Map<string, string>();
  for (const [kind, defs] of [["collections", collections], ["singletons", singletons]] as const) {
    for (const [name, def] of Object.entries(defs)) {
      const found = knownAccepts(def.fields, []);
      if (found.length === 0) continue;
      unknownTypes.set(`${kind}.${name}`, `"${def.label}" uses ${found.join(", ")}, which this version of Mica does not know: a newer or an older version of Mica wrote the model. Build the site with this version's @micacms/astro, or use the version of Mica that wrote it.`);
    }
  }

  // Left out, not refused: only the name at the top of the editor's menu depends on it.
  let label: string | undefined;
  if (raw.label !== undefined) {
    const problem = labelProblem(raw.label);
    if (problem) warnings.push(`The site's label ${problem}. The editor shows no name for the site.`);
    else label = raw.label;
  }

  let site: Site;
  try {
    const references = raw.references !== null && typeof raw.references === "object" ? raw.references : undefined;
    site = defineSite({ ...(label !== undefined ? { label } : {}), collections, singletons, ...(references ? { references } : {}) });
  } catch (error) {
    throw new ManifestError(`${origin} is not a valid content model.\n  ${(error as Error).message}`);
  }
  const readOnly = readOnlyParts(site);
  for (const [key, reason] of unknownTypes) if (!readOnly.has(key)) readOnly.set(key, reason);
  return { site, readOnly, warnings };
}

function assertFieldMap(fields: unknown, at: string, origin: string): void {
  if (fields === null || typeof fields !== "object") {
    throw new ManifestError(`${origin}: "${at}" has no \`fields\` object.`);
  }
  for (const [key, field] of Object.entries(fields as FieldMap)) {
    const here = `${at}.${key}`;
    if (field === null || typeof field !== "object") throw new ManifestError(`${origin}: field "${here}" is not an object.`);
    if (field.kind === "object" || field.kind === "repeater") assertFieldMap(field.fields, here, origin);
  }
}

/**
 * The collections and singletons this build of Mica must not write, keyed
 * `collections.<name>` or `singletons.<name>`, with the reason for the editor.
 * A field kind or an option from a newer @micacms/astro can change what is
 * stored, so it makes only its own collection or singleton read-only; Mica
 * still starts, and the rest stays editable.
 */
export function readOnlyParts(site: Site): Map<string, string> {
  const parts = new Map<string, string>();
  const add = (key: string, def: Collection | Singleton) => {
    const unknown = unknownFieldParts(def.fields);
    if (unknown.length > 0) {
      parts.set(
        key,
        `"${def.label}" uses ${unknown.join(", ")}, which this version of Mica does not know: a newer or an older version of Mica wrote the model. Build the site with this version's @micacms/astro, or use the version of Mica that wrote it.`,
      );
    }
  };
  for (const [name, def] of Object.entries(site.collections)) add(`collections.${name}`, def);
  for (const [name, def] of Object.entries(site.singletons)) add(`singletons.${name}`, def);
  return parts;
}

/** Each field kind and option that this build does not know, as `"path" (kind)` or `"path" (option name)`. */
export function unknownFieldParts(fields: FieldMap, at: string[] = []): string[] {
  return Object.entries(fields).flatMap(([key, field]) => {
    const here = [...at, key].join(".");
    if (!isFieldKind(field.kind)) return [`"${here}" (${String(field.kind)})`];
    const known: readonly string[] = [...COMMON_OPTIONS, ...FIELD_OPTIONS[field.kind]];
    const options = Object.keys(field).filter((option) => !known.includes(option)).map((option) => `"${here}" (option ${option})`);
    const nested = field.kind === "object" || field.kind === "repeater" ? unknownFieldParts(field.fields, [...at, key]) : [];
    return [...options, ...nested];
  });
}

/**
 * Keeps the toolbar features that this build knows, nested fields included; an
 * unknown preset becomes the default. Returns the paths of the fields it changed.
 */
function knownToolbars(fields: FieldMap, at: string[]): string[] {
  const known = RICH_TEXT_TOOLBARS.full as readonly string[];
  const changed: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    const raw = field as unknown as Record<string, unknown>;
    if (field.kind === "richText" && raw["toolbar"] !== undefined) {
      const toolbar = raw["toolbar"];
      if (Array.isArray(toolbar)) {
        const kept = toolbar.filter((feature) => known.includes(feature as string));
        if (kept.length !== toolbar.length) changed.push([...at, key].join("."));
        raw["toolbar"] = kept;
      } else if (typeof toolbar !== "string" || !Object.hasOwn(RICH_TEXT_TOOLBARS, toolbar)) {
        changed.push([...at, key].join("."));
        delete raw["toolbar"];
      }
    }
    if (field.kind === "object" || field.kind === "repeater") changed.push(...knownToolbars(field.fields, [...at, key]));
  }
  return changed;
}

/**
 * Keeps the file types that this build knows in each `accept` list, nested
 * fields included; a list with none left loses its `accept`. Returns each
 * unknown type as `"path" (file type name)`.
 */
function knownAccepts(fields: FieldMap, at: string[]): string[] {
  const found: string[] = [];
  for (const [key, field] of Object.entries(fields)) {
    const raw = field as unknown as Record<string, unknown>;
    const here = [...at, key];
    if (field.kind === "media" && typeof raw["accept"] === "string" && !["image", "document", "any"].includes(raw["accept"])) {
      found.push(`"${here.join(".")}" (accept ${raw["accept"]})`);
      delete raw["accept"];
    } else if (field.kind === "media" && Array.isArray(raw["accept"])) {
      const accept = raw["accept"] as unknown[];
      const unknown = accept.filter((name) => !isMediaFileType(name));
      found.push(...unknown.map((name) => `"${here.join(".")}" (file type ${String(name)})`));
      const kept = accept.filter(isMediaFileType);
      if (kept.length === 0) delete raw["accept"];
      else raw["accept"] = kept;
    }
    if (field.kind === "object" || field.kind === "repeater") found.push(...knownAccepts(field.fields, here));
  }
  return found;
}

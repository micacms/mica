/**
 * The Mica protocol.
 *
 * The manifest is what an Astro project tells Mica about itself: the collections
 * and singletons it defines, and the version of the contract that description
 * follows. Mica reads it and generates an editor; it holds no model of its own.
 *
 * Compatibility is expressed through `protocolVersion`, not through matching
 * npm versions. A Mica deployment and the `@micacms/astro` in a customer
 * project are upgraded by different people at different times, and requiring
 * them to move together would make every Mica release a coordinated migration.
 *
 * Prefer asking the manifest what it contains over branching on the version.
 * The version is the backstop for changes that cannot be detected by looking.
 */

import { deriveLayout, type EntryLayout } from "./layout.js";
import type { Collection, Singleton, Site } from "./types.js";

/**
 * Bumped only when an older reader would *misinterpret* a newer manifest.
 * Adding a field kind, or an option to an existing kind, does not qualify:
 * an unknown kind is detectable, and the editor can decline to render it.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Where the manifest lives, relative to the content root. The Astro build writes it, the developer
 * commits it, and Mica reads it like content: nothing to mount, and a model change shows in a diff.
 * Below the content root because Mica reads nothing above it; hidden because it is build output.
 */
export const MANIFEST_PATH = ".mica/schema.json";

/**
 * How the entries of a collection or singleton are stored. Recorded so that a
 * reader does not have to derive it from fields it may not understand, and so
 * that a layout change shows in the manifest's diff.
 */
export interface ManifestLayout {
  layout: EntryLayout;
}

/**
 * Holds nothing that changes without a model change, such as a package version
 * or a timestamp: a self-hosted Mica must restart for every change to this file.
 */
export interface ProtocolManifest {
  protocolVersion: number;
  /** The package that wrote the manifest, without its version: `@micacms/astro`. */
  generatedBy: string;
  collections: Record<string, Collection & ManifestLayout>;
  singletons: Record<string, Singleton & ManifestLayout>;
}

export function createManifest(site: Site, generatedBy: string): ProtocolManifest {
  const withLayout = <T extends Collection | Singleton>(defs: Record<string, T>) =>
    Object.fromEntries(Object.entries(defs).map(([name, def]) => [name, layoutAfterType(def)]));
  return {
    protocolVersion: PROTOCOL_VERSION,
    generatedBy,
    collections: withLayout(site.collections),
    singletons: withLayout(site.singletons),
  };
}

/** `layout` right after `type`, where a reader of the file looks for it. */
function layoutAfterType<T extends Collection | Singleton>(def: T): T & ManifestLayout {
  return Object.assign({ type: def.type, layout: deriveLayout(def.fields) }, def);
}

export type ManifestCompatibility =
  | { ok: true }
  /** The manifest is older than this reader and may lack what it needs. */
  | { ok: false; reason: "older"; version: number }
  /** The manifest is newer; this reader cannot be sure it understands it. */
  | { ok: false; reason: "newer"; version: number };

export function checkCompatibility(manifest: ProtocolManifest): ManifestCompatibility {
  if (manifest.protocolVersion === PROTOCOL_VERSION) return { ok: true };
  return {
    ok: false,
    reason: manifest.protocolVersion < PROTOCOL_VERSION ? "older" : "newer",
    version: manifest.protocolVersion,
  };
}

/**
 * Structural check for a manifest that arrives as untrusted data. Shallow on
 * purpose: `isFieldKind` checks field kinds where they are used, so it can
 * report the bad field instead of rejecting the site.
 */
export function isProtocolManifest(value: unknown): value is ProtocolManifest {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<ProtocolManifest>;

  return (
    typeof candidate.protocolVersion === "number" &&
    typeof candidate.generatedBy === "string" &&
    isRecord(candidate.collections) &&
    isRecord(candidate.singletons)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

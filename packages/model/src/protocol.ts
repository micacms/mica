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

import type { Collection, Singleton, Site } from "./types.js";

/**
 * Bumped only when an older reader would *misinterpret* a newer manifest.
 * Adding a field kind, or an option to an existing kind, does not qualify:
 * an unknown kind is detectable, and the editor can decline to render it.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Where the manifest lives, relative to the content root.
 *
 * The Astro build writes it; the developer commits it; Mica reads it back
 * through the same connector it reads entries with. That is the whole delivery
 * mechanism — the model reaches the server the way content does, so there is
 * nothing to mount, no second artifact to keep in step, and a model change is
 * reviewable in a diff like every other change.
 *
 * Below the content root because a connector cannot read above it. Hidden
 * because it is build output, not something an editor has any business in.
 */
export const MANIFEST_PATH = ".mica/schema.json";

export interface ProtocolManifest {
  protocolVersion: number;
  /** Package and version that produced this manifest, for diagnostics. */
  generatedBy: string;
  collections: Record<string, Collection>;
  singletons: Record<string, Singleton>;
}

export function createManifest(site: Site, generatedBy: string): ProtocolManifest {
  return {
    protocolVersion: PROTOCOL_VERSION,
    generatedBy,
    collections: { ...site.collections },
    singletons: { ...site.singletons },
  };
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
 * Structural check for a manifest arriving as untrusted data — read from disk,
 * or over HTTP from a project the reader did not build.
 *
 * Shallow on purpose: it establishes that the envelope is a manifest, not that
 * every field descriptor inside it is well formed. Field kinds are checked
 * where they are used, by `isFieldKind`, which can report the offending field
 * rather than rejecting the whole site.
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

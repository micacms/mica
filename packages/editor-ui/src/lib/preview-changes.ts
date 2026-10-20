/**
 * Which fields of the live preview have unpublished changes. The page names its
 * fields; this compares each one that a pending edit touches with the
 * repository's version, as the Publish page does. In a rich text, it also finds
 * the blocks that changed (`rich-text-changes.ts`), so that the page marks them
 * and not the whole text.
 */

import { api, type CompareTarget } from "@/api";
import type { Edit } from "@/lib/edits";

/** A field that the preview page shows: see `FieldMarker` in `@micacms/astro/preview`. */
export interface PreviewMarker {
  document: string;
  id: string;
  path: string;
}

/** A changed field. A rich text names its changed top-level blocks, when the change has some. */
export interface ChangedMarker extends PreviewMarker {
  blocks?: number[];
}

export function isPreviewMarker(value: unknown): value is PreviewMarker {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record["document"] === "string" && typeof record["id"] === "string" && typeof record["path"] === "string";
}

/** The value at a dotted path, such as `facts.2.label`. */
function valueAt(data: Record<string, unknown> | null, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matches(target: CompareTarget | null, marker: PreviewMarker): boolean {
  if (target?.kind === "entry") return target.collection === marker.document && target.slug === marker.id;
  if (target?.kind === "singleton") return target.name === marker.document;
  return false;
}

/** The markers whose field differs from the repository's version. `isRichText` says which ones get their changed blocks. */
export async function changedMarkers(
  markers: PreviewMarker[],
  edits: Edit[],
  isRichText: (marker: PreviewMarker) => boolean = () => false,
): Promise<ChangedMarker[]> {
  const byEdit = new Map<Edit, PreviewMarker[]>();
  for (const marker of markers) {
    const edit = edits.find((item) => matches(item.target, marker));
    if (edit) byEdit.set(edit, [...(byEdit.get(edit) ?? []), marker]);
  }

  const changed = await Promise.all(
    [...byEdit].map(async ([edit, own]) => {
      if (edit.state === "new") return own;
      try {
        const { before, after } = await api.staging.compare(edit.target!);
        const found = await Promise.all(
          own.map(async (marker): Promise<ChangedMarker[]> => {
            const [old, now] = [valueAt(before, marker.path), valueAt(after, marker.path)];
            if (JSON.stringify(old) === JSON.stringify(now)) return [];
            // Loaded here, so that Markdoc stays out of the editor's first download.
            const blocks = isRichText(marker) ? (await import("@/lib/rich-text-changes")).changedBlocks(old, now) : [];
            return [blocks.length > 0 ? { ...marker, blocks } : marker];
          }),
        );
        return found.flat();
      } catch {
        // The outline is a help: without the comparison, the fields keep the plain one.
        return [];
      }
    }),
  );
  return changed.flat();
}

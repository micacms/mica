/** Which piece of content a file belongs to, from the layout of `layout.ts` alone. */

import { MEDIA_DIR } from "./layout.js";
import { ORDER_FILE } from "./read.js";
import { isValidId } from "./to-id.js";
import type { Site } from "./types.js";

/** The owner of a file, with a label in words an editor recognises. */
export type PathOwner =
  | { kind: "entry"; collection: string; id: string; label: string }
  | { kind: "singleton"; name: string; label: string }
  | { kind: "order"; collection: string; label: string }
  | { kind: "media"; label: string }
  | { kind: "other"; label: string };

/** The entry, singleton, order or shared media that the file at `path`, from the content root, belongs to. */
export function ownerOfPath(model: Site, path: string): PathOwner {
  const segments = path.split("/");
  const head = segments[0] ?? "";

  const collection = Object.hasOwn(model.collections, head) ? model.collections[head] : undefined;
  if (collection && segments.length > 1) {
    if (segments.length === 2 && segments[1] === ORDER_FILE) {
      return { kind: "order", collection: head, label: `${collection.label}: order` };
    }

    const id = segments[1]!;
    if (segments.length >= 3 && isValidId(id)) return { kind: "entry", collection: head, id, label: id };
  }

  const singleton = Object.hasOwn(model.singletons, head) ? model.singletons[head] : undefined;
  if (singleton && segments.length > 1) return { kind: "singleton", name: head, label: singleton.label };

  if (head === MEDIA_DIR) return { kind: "media", label: "Shared media" };

  return { kind: "other", label: path };
}

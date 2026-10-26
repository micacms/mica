/**
 * An upload, the same for every interface that offers it: the editor and an agent.
 */

import type { MediaAccept } from "@micacms/core/internal";

import type { RuntimeContext } from "../context.js";
import { ApiError } from "../lib/errors.js";
import type { MediaFile } from "./media.js";
import { refuseReadOnlyFolder } from "./model-guard.js";

export interface UploadInput {
  body: ReadableStream<Uint8Array>;
  /** The file's own name, for the new name. */
  name: string;
  /** The announced size, to refuse a large file before it arrives. */
  size?: number;
  /** An entry's own `media/` folder, or the shared one when absent. */
  directory?: string;
  accept?: MediaAccept;
  /** For a new entry, which uploads into the folder of the ID in its form: never into a saved entry's. */
  newEntry?: boolean;
}

/** Writes one file into the content root, or nothing. Refuses a folder of a part that this build cannot write. */
export async function storeUpload(ctx: RuntimeContext, input: UploadInput): Promise<MediaFile> {
  refuseReadOnlyFolder(ctx, input.directory ?? "");
  if (input.newEntry) await refuseSavedEntryFolder(ctx, input.directory ?? "");

  const received = await ctx.services.media.receive(input);
  try {
    await ctx.site.contentRepository.apply({ changes: received.changes });
  } catch (error) {
    await ctx.services.media.discard(received.temporary);
    throw error;
  }
  return received.file;
}

/** A new entry's upload into `<collection>/<ID>/media` is refused while a saved entry has that ID. */
async function refuseSavedEntryFolder(ctx: RuntimeContext, directory: string): Promise<void> {
  const folder = /^([^/]+)\/([^/]+)\/media$/.exec(directory.replace(/^\/+/, ""));
  if (!folder || !ctx.site.model.collections[folder[1]!]) return;
  if ((await ctx.services.content.revisionOf(folder[1]!, folder[2]!)) !== null) {
    throw new ApiError("conflict", `Another entry already has the ID “${folder[2]}”. Change the ID, then upload.`);
  }
}

/**
 * An upload, the same for every interface that offers it: the editor and an agent.
 */

import type { RuntimeContext } from "../context.js";
import { ApiError } from "../lib/errors.js";
import type { MediaFile } from "./media.js";

export interface UploadInput {
  body: ReadableStream<Uint8Array>;
  /** The file's own name, for the new name. */
  name: string;
  /** The announced size, to refuse a large file before it arrives. */
  size?: number;
  /** An entry's own `media/` folder, or the shared one when absent. */
  directory?: string;
  accept?: "image" | "document" | "any";
}

/** Writes one file into the content root, or nothing. Refuses a folder of a part that this build cannot write. */
export async function storeUpload(ctx: RuntimeContext, input: UploadInput): Promise<MediaFile> {
  // The media service accepts `/gallery/x/media` too; take the owner from the path it will write to.
  const owner = (input.directory ?? "").replace(/^[/\\]+/, "").split(/[/\\]/)[0] ?? "";
  const readOnly = ctx.site.readOnly.get(`collections.${owner}`) ?? ctx.site.readOnly.get(`singletons.${owner}`);
  if (readOnly) throw new ApiError("conflict", readOnly);

  const received = await ctx.services.media.receive(input);
  try {
    await ctx.site.contentRepository.apply({ changes: received.changes });
  } catch (error) {
    await ctx.services.media.discard(received.temporary);
    throw error;
  }
  return received.file;
}

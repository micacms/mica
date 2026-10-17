/**
 * A delete of media files: a pending change like any other, refused while
 * something uses one of the files.
 */

import { MEDIA_DIR } from "@micacms/core/internal";

import type { RuntimeContext } from "../context.js";
import { ApiError, badRequest, notFound } from "../lib/errors.js";
import type { Referrer } from "./links.js";
import { refuseReadOnlyFolder } from "./model-guard.js";

/** Deletes the files at `paths`, content paths in a `media/` folder, or none of them. */
export async function deleteMedia(ctx: RuntimeContext, paths: string[]): Promise<void> {
  // A file in a `media/` folder, as an upload writes it. Nothing else is deleted here.
  for (const path of paths) {
    if (path.split("/").at(-2) !== MEDIA_DIR) throw badRequest(`"${path}" is not a media file.`);
  }
  for (const path of paths) {
    refuseReadOnlyFolder(ctx, path);
    if ((await ctx.services.media.read(path)) === null) throw notFound(`There is no file "${path}".`);
  }

  const { uses, unreadable } = await ctx.services.content.mediaUses(paths);
  if (unreadable.length > 0) {
    throw new ApiError("conflict", `Mica cannot read ${unreadable.join(", ")}, so it cannot tell whether these files are used.`);
  }
  const used = paths.filter((path) => (uses[path] ?? []).length > 0);
  if (used.length > 0) throw new ApiError("conflict", used.map((path) => describeUses(path, uses[path]!)).join(" "));

  await ctx.site.contentRepository.apply({ changes: paths.map((path) => ({ type: "delete" as const, path })) });
}

function describeUses(path: string, referrers: Referrer[]): string {
  const names = referrers.map((item) => item.title);
  const listed = names.slice(0, 3).join(", ") + (names.length > 3 ? ` and ${names.length - 3} more` : "");
  return `"${path.split("/").at(-1)}" is still used by ${listed}. Remove it there first.`;
}

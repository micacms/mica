/**
 * Writes wait while a newer content model cannot be read: a save with the
 * model in use would leave out the fields that only the new model has, and
 * still answer with success. Reads go on with the model in use.
 */

import type { RuntimeContext } from "../context.js";
import { ApiError } from "../lib/errors.js";

export const MODEL_UNREADABLE = "The content model changed, and this Mica cannot read it. Restart or upgrade Mica.";

/** Throws a 409 while `site.modelWarning` is set. Every interface calls it before a write: the editor and an agent. */
export function refuseWhileModelUnreadable(ctx: RuntimeContext): void {
  if (ctx.site.modelWarning) throw new ApiError("model_unreadable", MODEL_UNREADABLE);
}

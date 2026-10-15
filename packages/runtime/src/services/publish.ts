/**
 * Publish, the same for every interface that offers it: the editor and an agent.
 */

import type { PublishResult } from "@micacms/core/internal";

import type { RuntimeContext } from "../context.js";
import { ApiError } from "../lib/errors.js";
import type { PublishInput } from "./changes.js";

/** Publishes the reviewed paths. Validates with the newest model, so a model change never needs a restart first. */
export async function publishChanges(ctx: RuntimeContext, input: PublishInput): Promise<PublishResult> {
  await ctx.refreshModel({ force: true });
  const warning = ctx.site.modelWarning;
  if (warning) {
    throw new ApiError(
      "conflict",
      `The website's new content model cannot be read, so Mica cannot publish yet. Tell the developer: ${warning.message}`,
    );
  }
  return ctx.services.staging.publish(input);
}

/**
 * Publish, the same for every interface that offers it: the editor and an agent.
 */

import type { PublishResult } from "@micacms/core/internal";

import type { RuntimeContext } from "../context.js";
import type { PublishInput } from "./changes.js";
import { refuseWhileModelUnreadable } from "./model-guard.js";

/** Publishes the reviewed paths. Validates with the newest model, so a model change never needs a restart first. */
export async function publishChanges(ctx: RuntimeContext, input: PublishInput): Promise<PublishResult> {
  await ctx.refreshModel({ force: true });
  refuseWhileModelUnreadable(ctx);
  return ctx.services.staging.publish(input);
}

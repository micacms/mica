/**
 * Builds the runtime's services for one site, with no module-level singletons.
 * The app supplies the working tree's files and the owner policy, so the
 * runtime stays authentication-neutral.
 */

import type { Site } from "@micacms/core";

import type { RuntimeConfig } from "./config.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
import { readOnlyParts } from "./schema.js";
import { createMediaService, type MediaService } from "./services/media.js";
import type { ContentStagingService } from "./services/changes.js";
import { createContentStore, type ContentStore } from "./services/content-store.js";
import { createWorkingTreeStagingService } from "./services/staging.js";
import { createWorkspaceLocks, lockedFiles, type WorkspaceLocks } from "./workspace/locks.js";
import type { OwnerPolicy } from "./workspace/policy.js";
import type { ContentFiles } from "./workspace/files.js";
import type { GitTree } from "./workspace/tree.js";

/** The one site this process serves. Several sites means several processes. */
export interface SiteContext {
  /** Identifies this site in logs. */
  id: string;
  /** The content model, read from the repository at startup. */
  model: Site;
  /** The working tree's files behind the workspace locks. Only Publish makes a commit. */
  contentRepository: ContentFiles;
  /**
   * Revision of `.mica/schema.json` when the model was loaded. The publish
   * drift gate compares against it.
   */
  schemaRevision: string | null;
  /** Collections and singletons this build cannot write, from `readOnlyParts`, with the reason. */
  readOnly: ReadonlyMap<string, string>;
}

export const DEFAULT_SITE_ID = "default";

/** Facts about the composition that the System page shows and the runtime cannot know. */
export interface OperationalInfo {
  /** How this deployment authenticates, in words. */
  auth: string;
  /** What decides who may edit, in the operator's own words. */
  admission?: string;
  dataDir?: string;
  sessionTtlHours?: number;
  sessionIdleHours?: number;
  /** Names of the secrets this process generated for itself. */
  generatedSecrets?: string[];
}

/** What /ready asks the composition. */
export interface RuntimeHealth {
  /**
   * Whether the site can be edited, with short reason codes. Never names the
   * repository: the endpoint is public.
   */
  ready?: () => { ok: boolean; reasons: string[] };
}

export interface RuntimeContext {
  config: RuntimeConfig;
  site: SiteContext;
  logger: Logger;
  services: {
    content: ContentStore;
    media: MediaService;
    staging: ContentStagingService;
  };
  limiters: {
    api: RateLimiter;
  };
  operational(): OperationalInfo;
  health: RuntimeHealth;
  shutdown(): Promise<void>;
}

export interface CreateRuntimeContextOptions {
  config: RuntimeConfig;
  model: Site;
  /** The working tree's files, without locks. The app builds it. */
  files: ContentFiles;
  /** Revision of the manifest the model was read from. Null when unknown. */
  schemaRevision?: string | null;
  siteId?: string;
  logger?: Logger;
  operational?: () => OperationalInfo;
  health?: RuntimeHealth;
  /** Who owns the working tree. Defaults to the developer. */
  policy?: OwnerPolicy;
  /** Shared with the owner's own work on the tree, such as a sync. */
  locks?: WorkspaceLocks;
  /** See `WorkingTreeStagingDeps.tree`. */
  tree?: GitTree;
  onShutdown?: () => void | Promise<void>;
}

export function createRuntimeContext(options: CreateRuntimeContextOptions): RuntimeContext {
  const { config, model } = options;

  const logger =
    options.logger ??
    createLogger({
      level: config.LOG_LEVEL,
      pretty: !config.isProduction,
    });

  const schemaRevision = options.schemaRevision ?? null;

  // Services write through the lock wrapper; staging takes the locks itself.
  const locks = options.locks ?? createWorkspaceLocks();

  const readOnly = readOnlyParts(model);
  for (const reason of readOnly.values()) logger.warn("Read-only in this version of Mica", { reason });

  const site: SiteContext = {
    id: options.siteId ?? DEFAULT_SITE_ID,
    model,
    contentRepository: lockedFiles(options.files, locks.tree),
    schemaRevision,
    readOnly,
  };

  const services = {
    content: createContentStore(model, site.contentRepository, readOnly),
    media: createMediaService({
      files: site.contentRepository,
      maxBytes: config.MAX_UPLOAD_BYTES,
    }),
    staging: createWorkingTreeStagingService({
      model,
      files: options.files,
      contentRoot: config.contentRoot,
      schemaRevision,
      readOnly,
      publishEnabled: config.MICA_LOCAL_PUBLISH,
      logger,
      locks,
      ...(options.policy ? { policy: options.policy } : {}),
      ...(options.tree ? { tree: options.tree } : {}),
    }),
  };

  const limiters = {
    // Generous: it stops runaway scripts, it does not shape traffic.
    api: createRateLimiter({ limit: 600, windowMs: 60_000 }),
  };

  return {
    config,
    site,
    logger,
    services,
    limiters,
    operational:
      options.operational ??
      (() => ({ auth: "unspecified" })),
    health: options.health ?? {},

    async shutdown() {
      limiters.api.stop();
      await options.onShutdown?.();
    },
  };
}

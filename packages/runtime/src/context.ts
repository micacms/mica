/**
 * Builds the runtime's services for one site, with no module-level singletons.
 * The app supplies the working tree's files and the owner policy, so the
 * runtime stays authentication-neutral.
 */

import { MANIFEST_PATH, readOnlyParts, type Site } from "@micacms/core/internal";

import type { RuntimeConfig } from "./config.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
import { loadSchema, SchemaError } from "./schema.js";
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
  /** The content model in use: read at startup, and again when `.mica/schema.json` changes. */
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
  /** Why the newer model in the working tree is not in use. The model above stays in use. */
  modelWarning: { message: string; revision: string | null } | null;
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
}

/** What /ready asks the composition. */
export interface RuntimeHealth {
  /**
   * Whether something needs a person, with short reason codes. Never names the
   * repository: the endpoint is public.
   */
  ready?: () => { degraded: boolean; reasons: string[]; lastSyncAt: string | null };
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
  /**
   * Uses a new content model when `.mica/schema.json` changed, and keeps the one
   * in use when the new one cannot be read. Checks at most every two seconds,
   * unless `force`.
   */
  refreshModel(options?: { force?: boolean }): Promise<void>;
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
  /** Called after a new model is in use, for what the app keeps beside the runtime. */
  onModel?: (model: Site) => void;
  onShutdown?: () => void | Promise<void>;
}

export function createRuntimeContext(options: CreateRuntimeContextOptions): RuntimeContext {
  const { config, model } = options;

  const logger =
    options.logger ??
    createLogger({
      level: config.MICA_LOG_LEVEL,
      pretty: process.stdout.isTTY === true,
    });

  const schemaRevision = options.schemaRevision ?? null;

  // Services write through the lock wrapper; staging takes the locks itself.
  const locks = options.locks ?? createWorkspaceLocks();

  const site: SiteContext = {
    id: options.siteId ?? DEFAULT_SITE_ID,
    model,
    contentRepository: lockedFiles(options.files, locks.tree),
    schemaRevision,
    readOnly: new Map(),
    modelWarning: null,
  };

  /** The services that read the model. Media does not. */
  const forModel = (current: Site, revision: string | null) => {
    const readOnly = readOnlyParts(current);
    for (const reason of readOnly.values()) logger.warn("Read-only in this version of Mica", { reason });
    site.model = current;
    site.schemaRevision = revision;
    site.readOnly = readOnly;
    return {
      content: createContentStore(current, site.contentRepository, readOnly),
      staging: createWorkingTreeStagingService({
        model: current,
        files: options.files,
        contentRoot: config.contentRoot,
        schemaRevision: revision,
        readOnly,
        publishEnabled: config.MICA_LOCAL_PUBLISH,
        logger,
        locks,
        ...(options.policy ? { policy: options.policy } : {}),
        ...(options.tree ? { tree: options.tree } : {}),
      }),
    };
  };

  // Routes read `ctx.services` on each request, so a reload replaces these in place.
  const services = {
    ...forModel(model, schemaRevision),
    media: createMediaService({
      files: site.contentRepository,
      maxBytes: config.MICA_MAX_UPLOAD_BYTES,
    }),
  };

  let checkedAt = 0;
  let checking: Promise<void> | null = null;
  const refreshModel = (refresh: { force?: boolean } = {}): Promise<void> => {
    // A forced check must read the files as they are now, not join one that started earlier.
    if (checking) return refresh.force ? checking.then(() => refreshModel(refresh)) : checking;
    if (!refresh.force && Date.now() - checkedAt < 2_000) return Promise.resolve();
    checking = (async () => {
      checkedAt = Date.now();
      const revision = await options.files.revision(MANIFEST_PATH);
      if (revision === site.schemaRevision || revision === site.modelWarning?.revision) return;
      try {
        const next = await loadSchema(options.files);
        Object.assign(services, forModel(next, revision));
        site.modelWarning = null;
        logger.info("Using the new content model", { revision });
        options.onModel?.(next);
      } catch (error) {
        if (!(error instanceof SchemaError)) throw error;
        site.modelWarning = { message: error.message, revision };
        logger.warn("The new content model cannot be read; the one in use stays", { message: error.message });
      }
    })().finally(() => {
      checking = null;
    });
    return checking;
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
    refreshModel,

    async shutdown() {
      limiters.api.stop();
      await options.onShutdown?.();
    },
  };
}

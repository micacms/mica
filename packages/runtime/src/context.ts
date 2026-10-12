/**
 * The runtime's composition: one site, its services, and nothing about who
 * is allowed in.
 *
 * Everything is constructed here and passed down explicitly — no module-level
 * singletons, no service locator. The composing app builds the connector over
 * its working tree and, where it owns the tree, the owner policy; the runtime
 * receives them and never asks where they came from. That is what keeps this
 * package authentication-neutral.
 */

import type { Site } from "@micacms/core";

import type { RuntimeConfig } from "./config.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
import { createMediaService, type MediaService } from "./services/media.js";
import type { ContentStagingService } from "./services/changes.js";
import { createContentStore, type ContentStore } from "./services/content-store.js";
import { createWorkingTreeStagingService } from "./services/staging.js";
import { createWorkspaceLocks, lockedFiles, type WorkspaceLocks } from "./workspace/locks.js";
import type { OwnerPolicy } from "./workspace/policy.js";
import type { ContentFiles } from "./workspace/files.js";
import type { GitTree } from "./workspace/tree.js";

/**
 * The site this process serves. One, explicitly.
 *
 * Explicit rather than implicit even though there is only ever one: a runtime
 * that names its site is testable and has no global state, and a runtime that
 * *assumes* its site is the one that quietly grows a second. Several sites
 * means several processes.
 */
export interface SiteContext {
  /** Identifies this site in logs. Constant while one runtime serves one site. */
  id: string;
  /** The content model, read from the repository at startup. */
  model: Site;
  /**
   * What everything reads and saves through: the working tree, behind the
   * workspace locks. Only the staging service's Publish turns it into a commit.
   */
  contentRepository: ContentFiles;
  /**
   * Revision of `.mica/schema.json` when the model was loaded. The publish
   * drift gate compares against it — see decisions.md.
   */
  schemaRevision: string | null;
}

export const DEFAULT_SITE_ID = "default";

/**
 * What the composing app wants the System page to say about itself — the
 * facts the runtime cannot know because they belong to the composition: how
 * this deployment authenticates, and which rule admits people.
 */
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
   * The composition's own answer, which replaces the repository probe:
   * whether the site can be edited, and short reason codes. Never names the
   * repository — the endpoint is public.
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
  /** App-supplied: what the System page says about the composition. */
  operational(): OperationalInfo;
  /** App-supplied active probes for /ready. Absent means nothing to probe. */
  health: RuntimeHealth;
  /** Releases timers, and whatever the app added on top. */
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
  /** The tree, when the owner already knows it — see `WorkingTreeStagingDeps.tree`. */
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

  // A working tree is shared by saves, commits and discards; the services
  // write through the lock wrapper, and staging holds the locks itself.
  const locks = options.locks ?? createWorkspaceLocks();

  const site: SiteContext = {
    id: options.siteId ?? DEFAULT_SITE_ID,
    model,
    contentRepository: lockedFiles(options.files, locks.tree),
    schemaRevision,
  };

  const services = {
    content: createContentStore(model, site.contentRepository),
    media: createMediaService({
      files: site.contentRepository,
      maxBytes: config.MAX_UPLOAD_BYTES,
    }),
    staging: createWorkingTreeStagingService({
      model,
      files: options.files,
      contentRoot: config.contentRoot,
      schemaRevision,
      publishEnabled: config.MICA_LOCAL_PUBLISH,
      logger,
      locks,
      ...(options.policy ? { policy: options.policy } : {}),
      ...(options.tree ? { tree: options.tree } : {}),
    }),
  };

  const limiters = {
    // Generous: this exists to blunt runaway scripts, not to shape traffic.
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

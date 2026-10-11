/**
 * The runtime's composition: one site, its services, and nothing about who
 * is allowed in.
 *
 * Everything is constructed here and passed down explicitly — no module-level
 * singletons, no service locator. The composing app builds the connector and,
 * where one exists, the draft store and the database; the runtime receives
 * them and never asks where they came from. That is what keeps this package
 * authentication-neutral and database-free on a developer's machine: the
 * local editor simply never hands it either.
 */

import {
  createContentStore,
  githubConnector,
  gitlabConnector,
  localConnector,
  stagedConnector,
  type ContentStore,
} from "@micacms/connectors";
import type { DraftStore, RepositoryConnector, Site } from "@micacms/core";

import type { RuntimeConfig } from "./config.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
import { createMediaService, type MediaService } from "./services/media.js";
import { createDraftStagingService, type ContentStagingService } from "./services/staging.js";
import { createWorkingTreeStagingService } from "./services/staging-local.js";

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
   * What everything reads and saves through. With a draft store this is the
   * staged overlay — saves land in the draft, and only the staging service's
   * Publish reaches the repository itself.
   */
  contentRepository: RepositoryConnector;
  /**
   * Revision of `.mica/schema.json` when the model was loaded. The publish
   * drift gate compares against it — see decisions.md.
   */
  schemaRevision: string | null;
}

export const DEFAULT_SITE_ID = "default";

/**
 * What the composing app wants the System page to say about itself — the
 * facts the runtime cannot know because they belong to the composition:
 * whether there is a database, how this deployment authenticates, and which
 * rule admits people.
 */
export interface OperationalInfo {
  /** How this deployment authenticates, in words. */
  auth: string;
  /** Null where there is no database, which is the local editor's answer. */
  database: {
    path: string;
    version: number;
    bytes: number | null;
  } | null;
  /** What decides who may edit, in the operator's own words. */
  admission?: string;
  dataDir?: string;
  sessionTtlHours?: number;
  sessionIdleHours?: number;
  /** Names of the secrets this process generated for itself. */
  generatedSecrets?: string[];
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
  /** App-supplied active probes for /health/ready. Absent means nothing to probe. */
  health: {
    database?: () => void;
  };
  /** Releases timers, and whatever the app added on top. */
  shutdown(): Promise<void>;
}

export interface CreateRuntimeContextOptions {
  config: RuntimeConfig;
  model: Site;
  /** How the content repository is reached. The app builds it. */
  connector: RepositoryConnector;
  /**
   * Where saves accumulate when the repository is remote. Absent means the
   * working tree is the draft workspace — the local editor, or a self-hosted
   * deployment with a checkout beside it.
   */
  drafts?: DraftStore;
  /** Revision of the manifest the model was read from. Null when unknown. */
  schemaRevision?: string | null;
  siteId?: string;
  logger?: Logger;
  operational?: () => OperationalInfo;
  health?: { database?: () => void };
  onShutdown?: () => void | Promise<void>;
}

export function createRuntimeContext(options: CreateRuntimeContextOptions): RuntimeContext {
  const { config, model, drafts } = options;

  const logger =
    options.logger ??
    createLogger({
      level: config.LOG_LEVEL,
      pretty: !config.isProduction,
    });

  const schemaRevision = options.schemaRevision ?? null;

  const site: SiteContext = {
    id: options.siteId ?? DEFAULT_SITE_ID,
    model,
    contentRepository: drafts ? stagedConnector(options.connector, drafts) : options.connector,
    schemaRevision,
  };

  const services = {
    content: createContentStore(model, site.contentRepository),
    media: createMediaService({
      connector: site.contentRepository,
      maxBytes: config.MAX_UPLOAD_BYTES,
    }),
    staging: drafts
      ? createDraftStagingService({
          model,
          drafts,
          repository: options.connector,
          overlay: site.contentRepository,
          schemaRevision,
        })
      : createWorkingTreeStagingService({
          model,
          connector: site.contentRepository,
          contentRoot: config.contentRoot,
          schemaRevision,
          publishEnabled: config.MICA_LOCAL_PUBLISH,
          logger,
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
      (() => ({ auth: "unspecified", database: null })),
    health: options.health ?? {},

    async shutdown() {
      limiters.api.stop();
      await options.onShutdown?.();
    },
  };
}

/**
 * The one place that decides how Mica reaches a configured content
 * repository. Every mode produces the same interface, so nothing downstream
 * can tell which one it got.
 *
 * The local editor does not call this — it *is* the local connector — but the
 * self-hosted app serves whichever repository its environment names.
 */
export function createConnector(config: RuntimeConfig): RepositoryConnector {
  const author = { name: "Mica CMS", email: "mica@localhost" };

  const require = (value: string | undefined, what: string): string => {
    if (!value) {
      throw new Error(`REPOSITORY is "${config.REPOSITORY}" but ${what} is not set.`);
    }
    return value;
  };

  switch (config.REPOSITORY) {
    case "github": {
      const project = require(config.REPOSITORY_PROJECT, "REPOSITORY_PROJECT");
      return githubConnector({
        owner: project.split("/")[0]!,
        repo: project.split("/").slice(1).join("/"),
        branch: config.REPOSITORY_BRANCH,
        root: config.REPOSITORY_ROOT,
        token: require(config.REPOSITORY_TOKEN, "REPOSITORY_TOKEN"),
        apiBase: config.REPOSITORY_API_BASE,
        author,
      });
    }

    case "gitlab":
      return gitlabConnector({
        project: require(config.REPOSITORY_PROJECT, "REPOSITORY_PROJECT"),
        branch: config.REPOSITORY_BRANCH,
        root: config.REPOSITORY_ROOT,
        token: require(config.REPOSITORY_TOKEN, "REPOSITORY_TOKEN"),
        apiBase: config.REPOSITORY_API_BASE,
        author,
      });

    case "local":
      return localConnector({ root: config.contentRoot });
  }
}

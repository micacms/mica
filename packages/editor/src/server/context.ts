/**
 * Composition root.
 *
 * Everything is constructed here and passed down explicitly — no module-level
 * singletons, no service locator. That is what lets a test build a complete
 * application against an in-memory database and a temporary content directory.
 *
 * Note what the database is for: sessions, and — with a provider repository —
 * the pending draft. Content, media and their history live in the repository,
 * reached through a connector. Losing this database signs everyone out; where
 * saves are staged in it, losing it also loses work that was saved and not
 * yet published, which the self-hosted backup guidance says out loud.
 */

import {
  createContentStore,
  githubConnector,
  gitlabConnector,
  localConnector,
  stagedConnector,
  type ContentStore,
  type RepositoryConnector,
} from "@micacms/connectors";
import type { Site } from "@micacms/model";

import type { Config } from "./config.js";
import { openDatabase, type SqlDatabase } from "./db/index.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
import { createDraftRepository } from "./repositories/drafts.js";
import { createSessionRepository } from "./repositories/sessions.js";
import { createAdmissionPolicy, type AdmissionPolicy } from "./services/admission.js";
import { createMediaService, type MediaService } from "./services/media.js";
import { createOidcService, type OidcService } from "./services/oidc.js";
import { createSessionService, type SessionService } from "./services/session.js";
import { createDraftStagingService, type ContentStagingService } from "./services/staging.js";
import { createWorkingTreeStagingService } from "./services/staging-local.js";

/**
 * The site this process serves. One, explicitly.
 *
 * Explicit rather than implicit even though there is only ever one: a runtime
 * that names its site is testable and has no global state, and a runtime that
 * *assumes* its site is the one that quietly grows a second. This is not a
 * hidden multi-site implementation — there are no tenants, no memberships and
 * no site table to hold a second one. Several sites means several processes.
 */
export interface SiteContext {
  /**
   * Identifies this site in logs and, later, in a draft store shared by
   * nothing. Constant while one runtime serves one site; it becomes
   * configuration on the day a control plane runs several.
   */
  id: string;
  /** The content model, read from the repository at startup. */
  model: Site;
  /**
   * What everything reads and saves through. With a provider repository this
   * is the staged overlay — saves land in the draft store, and only the
   * staging service's Publish reaches the repository itself.
   */
  contentRepository: RepositoryConnector;
  /**
   * Revision of `.mica/schema.json` when the model was loaded. The publish
   * drift gate compares against it: content staged under one model must not
   * be published under another — see decisions.md.
   */
  schemaRevision: string | null;
}

export const DEFAULT_SITE_ID = "default";

export interface AppContext {
  config: Config;
  site: SiteContext;
  logger: Logger;
  db: SqlDatabase;
  repositories: {
    sessions: ReturnType<typeof createSessionRepository>;
  };
  services: {
    content: ContentStore;
    media: MediaService;
    sessions: SessionService;
    oidc: OidcService;
    admission: AdmissionPolicy;
    staging: ContentStagingService;
  };
  limiters: {
    login: RateLimiter;
    api: RateLimiter;
  };
  /** Releases timers and the database handle. */
  shutdown(): Promise<void>;
}

export interface CreateContextOptions {
  config: Config;
  model: Site;
  /** Overrides for tests: in-memory database, temporary content directory. */
  db?: SqlDatabase;
  connector?: RepositoryConnector;
  siteId?: string;
  logger?: Logger;
  /** Revision of the manifest the model was read from. Null when unknown. */
  schemaRevision?: string | null;
}

export function createContext(options: CreateContextOptions): AppContext {
  const { config, model } = options;

  const logger =
    options.logger ??
    createLogger({
      level: config.LOG_LEVEL,
      pretty: !config.isProduction,
    });

  const db = options.db ?? openDatabase(config.databasePath, { logger });

  /**
   * How saving relates to the repository — the Phase B fork in the road.
   *
   * A working tree *is* the draft workspace: autosave writes files the Astro
   * dev server can hot-reload, and Publish is Git. A provider repository
   * cannot work that way — writing through its API is already a commit — so
   * saves are staged in the database and read back through an overlay, and
   * only the staging service's Publish touches the repository itself.
   */
  const repository = options.connector ?? createConnector(config);
  const schemaRevision = options.schemaRevision ?? null;
  const drafts = config.REPOSITORY === "local" ? null : createDraftRepository(db);

  const site: SiteContext = {
    id: options.siteId ?? DEFAULT_SITE_ID,
    model,
    contentRepository: drafts ? stagedConnector(repository, drafts) : repository,
    schemaRevision,
  };

  const repositories = {
    sessions: createSessionRepository(db),
  };

  const services = {
    content: createContentStore(model, site.contentRepository),
    media: createMediaService({
      connector: site.contentRepository,
      maxBytes: config.MAX_UPLOAD_BYTES,
    }),
    sessions: createSessionService(repositories.sessions, config),
    oidc: createOidcService({ config, logger }),
    admission: createAdmissionPolicy(config),
    staging: drafts
      ? createDraftStagingService({
          model,
          drafts,
          repository,
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
    login: createRateLimiter({
      limit: config.LOGIN_MAX_ATTEMPTS,
      windowMs: config.LOGIN_WINDOW_MS,
    }),
    // Generous: this exists to blunt runaway scripts, not to shape traffic.
    api: createRateLimiter({ limit: 600, windowMs: 60_000 }),
  };

  // Expired rows would otherwise accumulate until someone happened to log in.
  const sessionSweep = setInterval(
    () => {
      const removed = services.sessions.purgeExpired();
      if (removed > 0) logger.debug("Purged expired sessions", { removed });
    },
    60 * 60 * 1000,
  );
  sessionSweep.unref?.();

  return {
    config,
    site,
    logger,
    db,
    repositories,
    services,
    limiters,

    async shutdown() {
      clearInterval(sessionSweep);
      limiters.login.stop();
      limiters.api.stop();
      db.close();
    },
  };
}

/**
 * The one place that decides how Mica reaches the content repository.
 *
 * Every mode produces the same interface, so nothing downstream — not the
 * content store, not a route, not the media service — can tell which one it
 * got. That is the property that makes a hosted Mica and a developer's
 * `pnpm dev` the same program.
 *
 * Configuration, and only configuration. A repository connection used to be
 * readable from a `repository_connections` row as well, which was the multi-
 * site model arriving early: one runtime serves one site, and the environment
 * is where a deployment is described.
 *
 * Separate from `createContext` because of an ordering the design implies: the
 * content model is *in* the repository, so the process entry point has to build
 * a connector, read the model, and only then compose everything.
 */
export function createConnector(config: Config): RepositoryConnector {
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

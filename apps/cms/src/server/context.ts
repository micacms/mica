/**
 * Composition root.
 *
 * Everything is constructed here and passed down explicitly — no module-level
 * singletons, no service locator. That is what lets a test build a complete
 * application against an in-memory database and a temporary content directory.
 *
 * Note what the database is now for: users and sessions. Content, media and
 * their history live in the repository, reached through a connector. Losing
 * this database costs everyone their login, and nothing else.
 */

import {
  createContentStore,
  githubConnector,
  gitlabConnector,
  localConnector,
  type ContentStore,
  type RepositoryConnector,
} from "@micacms/connectors";
import type { Site } from "@micacms/model";

import type { Config } from "./config.js";
import { openDatabase, type SqlDatabase } from "./db/index.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
import { createIdentityRepository } from "./repositories/identities.js";
import { createMembershipRepository } from "./repositories/memberships.js";
import { createSessionRepository } from "./repositories/sessions.js";
import {
  createSiteRepository,
  DEFAULT_SITE_ID,
  type RepositoryConnectionRecord,
} from "./repositories/sites.js";
import { createUserRepository } from "./repositories/users.js";
import { createMediaService, type MediaService } from "./services/media.js";
import { createOidcService, type OidcService } from "./services/oidc.js";
import { createSessionService, type SessionService } from "./services/session.js";

export interface AppContext {
  config: Config;
  site: Site;
  logger: Logger;
  db: SqlDatabase;
  connector: RepositoryConnector;
  /**
   * The site this process is serving.
   *
   * One, for now. Every query that reads a membership or a repository
   * connection is already keyed by it, so serving several means resolving this
   * per request instead of once — and nothing above that line changes.
   */
  siteId: string;
  repositories: {
    sessions: ReturnType<typeof createSessionRepository>;
    users: ReturnType<typeof createUserRepository>;
    sites: ReturnType<typeof createSiteRepository>;
    memberships: ReturnType<typeof createMembershipRepository>;
    identities: ReturnType<typeof createIdentityRepository>;
  };
  services: {
    content: ContentStore;
    media: MediaService;
    sessions: SessionService;
    oidc: OidcService;
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
  site: Site;
  /** Overrides for tests: in-memory database, temporary content directory. */
  db?: SqlDatabase;
  connector?: RepositoryConnector;
  /** Defaults to the site migration 3 creates. */
  siteId?: string;
  logger?: Logger;
}

/**
 * The repository connector for a site, before there is a context to hold it.
 *
 * Separate from `createContext` because of an ordering the design implies: the
 * content model is *in* the repository, so it has to be read through a
 * connector, and the context cannot be built until the model is known. The
 * process entry point therefore opens the database, builds the connector,
 * reads the model, and only then composes everything.
 *
 * The site's stored connection wins over the environment. The environment is
 * how a single-site deployment is configured and will stay that way; the
 * stored connection is how a second site ever gets one. Reading the row first
 * means both work without a second code path.
 */
export function createConnector(
  config: Config,
  db: SqlDatabase,
  siteId: string = DEFAULT_SITE_ID,
): RepositoryConnector {
  return connectorFor(config, createSiteRepository(db).connection(siteId));
}

export function createContext(options: CreateContextOptions): AppContext {
  const { config, site } = options;

  const logger =
    options.logger ??
    createLogger({
      level: config.LOG_LEVEL,
      pretty: !config.isProduction,
    });

  const db = options.db ?? openDatabase(config.databasePath, { logger });

  const siteId = options.siteId ?? DEFAULT_SITE_ID;

  const repositories = {
    sessions: createSessionRepository(db),
    users: createUserRepository(db),
    sites: createSiteRepository(db),
    memberships: createMembershipRepository(db),
    identities: createIdentityRepository(db),
  };

  const connector =
    options.connector ?? connectorFor(config, repositories.sites.connection(siteId));

  const services = {
    content: createContentStore(site, connector),
    media: createMediaService({ connector, maxBytes: config.MAX_UPLOAD_BYTES }),
    sessions: createSessionService(repositories.sessions, config),
    oidc: createOidcService({ config, logger }),
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
    connector,
    siteId,
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
 */
function connectorFor(
  config: Config,
  stored: RepositoryConnectionRecord | undefined,
): RepositoryConnector {
  const author = { name: "Mica CMS", email: "mica@localhost" };

  // The stored connection if the site has one, otherwise the environment.
  // Written as one shape so the switch below does not have to know which.
  const settings = stored ?? {
    kind: config.REPOSITORY,
    project: config.REPOSITORY_PROJECT ?? null,
    branch: config.REPOSITORY_BRANCH,
    root: config.REPOSITORY_ROOT,
    apiBase: config.REPOSITORY_API_BASE ?? null,
    token: config.REPOSITORY_TOKEN ?? null,
  };

  const require = (value: string | null, what: string): string => {
    if (!value) {
      throw new Error(
        `The repository connection for this site is a ${settings.kind} connection but has no ${what}.`,
      );
    }
    return value;
  };

  switch (settings.kind) {
    case "github": {
      const project = require(settings.project, "project");
      return githubConnector({
        owner: project.split("/")[0]!,
        repo: project.split("/").slice(1).join("/"),
        branch: settings.branch,
        root: settings.root,
        token: require(settings.token, "token"),
        apiBase: settings.apiBase ?? undefined,
        author,
      });
    }

    case "gitlab":
      return gitlabConnector({
        project: require(settings.project, "project"),
        branch: settings.branch,
        root: settings.root,
        token: require(settings.token, "token"),
        apiBase: settings.apiBase ?? undefined,
        author,
      });

    case "local":
      return localConnector({ root: config.contentRoot });
  }
}

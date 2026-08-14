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
import { createSessionRepository } from "./repositories/sessions.js";
import { createUserRepository } from "./repositories/users.js";
import { createMediaService, type MediaService } from "./services/media.js";
import { createSessionService, type SessionService } from "./services/session.js";

export interface AppContext {
  config: Config;
  site: Site;
  logger: Logger;
  db: SqlDatabase;
  connector: RepositoryConnector;
  repositories: {
    sessions: ReturnType<typeof createSessionRepository>;
    users: ReturnType<typeof createUserRepository>;
  };
  services: {
    content: ContentStore;
    media: MediaService;
    sessions: SessionService;
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
  logger?: Logger;
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

  const connector = options.connector ?? connectorFor(config);

  const repositories = {
    sessions: createSessionRepository(db),
    users: createUserRepository(db),
  };

  const services = {
    content: createContentStore(site, connector),
    media: createMediaService({ connector, maxBytes: config.MAX_UPLOAD_BYTES }),
    sessions: createSessionService(repositories.sessions, config),
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
function connectorFor(config: Config): RepositoryConnector {
  const author = { name: "Mica CMS", email: "mica@localhost" };

  switch (config.REPOSITORY) {
    case "github":
      return githubConnector({
        // Validated at startup, so these are present by the time we are here.
        owner: config.REPOSITORY_PROJECT!.split("/")[0]!,
        repo: config.REPOSITORY_PROJECT!.split("/").slice(1).join("/"),
        branch: config.REPOSITORY_BRANCH,
        root: config.REPOSITORY_ROOT,
        token: config.REPOSITORY_TOKEN!,
        apiBase: config.REPOSITORY_API_BASE,
        author,
      });

    case "gitlab":
      return gitlabConnector({
        project: config.REPOSITORY_PROJECT!,
        branch: config.REPOSITORY_BRANCH,
        root: config.REPOSITORY_ROOT,
        token: config.REPOSITORY_TOKEN!,
        apiBase: config.REPOSITORY_API_BASE,
        author,
      });

    case "local":
      return localConnector({ root: config.contentRoot });
  }
}

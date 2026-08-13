/**
 * Composition root.
 *
 * Everything is constructed here and passed down explicitly — no module-level
 * singletons, no service locator. That is what lets a test build a complete
 * application against an in-memory database and a stub publisher.
 */

import type { Site } from "@micacms/model";

import type { Config } from "./config.js";
import { openDatabase, type SqlDatabase } from "./db/index.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
import { createEntryRepository } from "./repositories/entries.js";
import { createGlobalRepository } from "./repositories/globals.js";
import { createMediaRepository } from "./repositories/media.js";
import { createRevisionRepository } from "./repositories/revisions.js";
import { createSessionRepository } from "./repositories/sessions.js";
import { createUserRepository } from "./repositories/users.js";
import { createContentService, type ContentService } from "./services/content.js";
import { createMediaService, type MediaService } from "./services/media.js";
import { noopPublisher, webhook, type Publisher } from "./services/publisher.js";
import { createSessionService, type SessionService } from "./services/session.js";
import { localStorage, type MediaStorage } from "./services/storage.js";

export interface AppContext {
  config: Config;
  site: Site;
  logger: Logger;
  db: SqlDatabase;
  storage: MediaStorage;
  publisher: Publisher;
  repositories: {
    entries: ReturnType<typeof createEntryRepository>;
    globals: ReturnType<typeof createGlobalRepository>;
    media: ReturnType<typeof createMediaRepository>;
    revisions: ReturnType<typeof createRevisionRepository>;
    sessions: ReturnType<typeof createSessionRepository>;
    users: ReturnType<typeof createUserRepository>;
  };
  services: {
    content: ContentService;
    media: MediaService;
    sessions: SessionService;
  };
  limiters: {
    login: RateLimiter;
    api: RateLimiter;
  };
  /** Releases timers, database handle and pending webhook deliveries. */
  shutdown(): Promise<void>;
}

export interface CreateContextOptions {
  config: Config;
  site: Site;
  /** Overrides for tests: in-memory database, stub publisher, fake storage. */
  db?: SqlDatabase;
  publisher?: Publisher;
  storage?: MediaStorage;
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
  const storage = options.storage ?? localStorage({ directory: config.mediaDir });

  const publisher =
    options.publisher ??
    (config.BUILD_WEBHOOK_URL
      ? webhook({
          url: config.BUILD_WEBHOOK_URL,
          secret: config.BUILD_WEBHOOK_SECRET,
          debounceMs: config.PUBLISH_DEBOUNCE_MS,
          logger: logger.child({ component: "publisher" }),
        })
      : noopPublisher(logger.child({ component: "publisher" })));

  const repositories = {
    entries: createEntryRepository(db),
    globals: createGlobalRepository(db),
    media: createMediaRepository(db),
    revisions: createRevisionRepository(db),
    sessions: createSessionRepository(db),
    users: createUserRepository(db),
  };

  const services = {
    content: createContentService({
      site,
      db,
      entries: repositories.entries,
      globals: repositories.globals,
      revisions: repositories.revisions,
      media: repositories.media,
      publisher,
      baseUrl: config.CMS_BASE_URL,
    }),
    media: createMediaService({
      media: repositories.media,
      storage,
      maxBytes: config.MAX_UPLOAD_BYTES,
      logger: logger.child({ component: "media" }),
    }),
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
    storage,
    publisher,
    repositories,
    services,
    limiters,

    async shutdown() {
      clearInterval(sessionSweep);
      limiters.login.stop();
      limiters.api.stop();
      // Deliver anything queued before the process goes away.
      await publisher.flush().catch((error: unknown) => {
        logger.error("Failed to flush publisher on shutdown", { error: String(error) });
      });
      db.close();
    },
  };
}

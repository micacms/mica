/**
 * Process entry point.
 */

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { createLogger } from "./lib/logger.js";
import { loadSchema, schemaFingerprint, SchemaError } from "./schema.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const logger = createLogger({ level: config.LOG_LEVEL, pretty: !config.isProduction });

  // The model is the project's, not the server's. A bad one is a deployment
  // mistake rather than a crash: exit the way a bad environment does, with the
  // message on stderr instead of a stack trace.
  let site;
  try {
    site = await loadSchema(config.schemaPath);
  } catch (error) {
    if (error instanceof SchemaError) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const ctx = createContext({ config, site, logger });

  const devSecrets = (config as { devSecrets?: string[] }).devSecrets ?? [];
  if (devSecrets.length > 0) {
    logger.warn("Using generated development secrets", {
      missing: devSecrets,
      note: "Sessions reset on restart. Set these before deploying.",
    });
  }

  if (ctx.repositories.users.count() === 0) {
    logger.warn("No user accounts exist yet", {
      next: "Create the first administrator with: pnpm --filter @micacms/cms create-user",
    });
  }

  const app = createApp(ctx);

  const fingerprint = await schemaFingerprint(site);

  const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
    logger.info("Mica CMS started", {
      url: config.CMS_BASE_URL,
      listening: `${config.HOST}:${info.port}`,
      environment: config.NODE_ENV,
      database: config.databasePath,
      media: config.mediaDir,
      // Enough to tell two deployments apart when a website was built against
      // one model and the CMS is serving another.
      schema: config.schemaPath,
      schemaFingerprint: fingerprint,
      collections: Object.keys(site.collections).length,
    });
  });

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });

    // Stop accepting connections, then flush queued webhooks and close SQLite.
    server.close(() => {
      void ctx.shutdown().then(() => {
        logger.info("Shutdown complete");
        process.exit(0);
      });
    });

    // Do not let a hung connection block a container restart indefinitely.
    setTimeout(() => {
      logger.warn("Forcing exit after shutdown timeout");
      process.exit(1);
    }, 15_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason: String(reason) });
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

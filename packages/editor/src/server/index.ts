/**
 * Process entry point.
 */

import { serve } from "@hono/node-server";
import { MANIFEST_PATH } from "@micacms/model";

import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createConnector, createContext } from "./context.js";
import { openDatabase } from "./db/index.js";
import { portInUse, startupBanner, supportsColor } from "./lib/banner.js";
import { createLogger } from "./lib/logger.js";
import { openInBrowser } from "./lib/open.js";
import { VERSION } from "./lib/version.js";
import { loadSchema, schemaFingerprint, schemaOrigin, SchemaError } from "./schema.js";

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

  // The repository comes first, because the content model is in it. Mica holds
  // no model of its own: the Astro project writes one into the content root and
  // the developer commits it, so reading it is a repository read like any other.
  // `quiet` under the CLI: the banner is that audience's whole startup story,
  // and it cannot be printed until the schema has been read.
  const db = openDatabase(config.databasePath, { logger, quiet: config.MICA_CLI });
  const connector = createConnector(config);

  // A bad or absent model is a deployment mistake rather than a crash: exit the
  // way a bad environment does, with the message on stderr instead of a stack
  // trace.
  let model;
  try {
    model = await loadSchema(connector);
  } catch (error) {
    if (error instanceof SchemaError) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  // The manifest's revision at the moment the model was read. The publish
  // drift gate compares against it, so a model that moves under a pending
  // draft is a named refusal rather than a corrupted publication.
  const schemaRevision = await connector.revision(MANIFEST_PATH);

  const ctx = createContext({ config, model, db, connector, logger, schemaRevision });

  const devSecrets = (config as { devSecrets?: string[] }).devSecrets ?? [];
  // Not said under the CLI: there, the database is a cache directory that gets
  // thrown away anyway, and "your ephemeral secret is ephemeral" is a warning
  // about nothing. A deployment being one restart from signing everyone out is
  // a different matter, and still warned about.
  if (devSecrets.length > 0 && !config.MICA_CLI) {
    logger.warn("Using generated development secrets", {
      missing: devSecrets,
      note: "Sessions reset on restart. Set these before deploying.",
    });
  }

  const app = createApp(ctx);

  const fingerprint = await schemaFingerprint(model);

  const server = serve({ fetch: app.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
    /**
     * Two audiences, one event.
     *
     * The person who just typed a command gets an address and three facts; a
     * log collector gets every field. Saying both would mean saying the same
     * thing twice in two registers, so the front door picks one.
     */
    if (config.MICA_CLI) {
      const useColor = supportsColor(process.stdout, process.env);

      process.stdout.write(
        startupBanner(
          {
            version: VERSION,
            url: config.MICA_PUBLIC_URL,
            contentRoot: connector.origin,
            collections: Object.keys(model.collections).length,
            singletons: Object.keys(model.singletons).length,
            dataDir: config.dataDir,
            writesToWorkingTree: config.REPOSITORY === "local",
          },
          useColor,
        ),
      );

      if (config.MICA_OPEN) openInBrowser(`${config.MICA_PUBLIC_URL}/admin/`);
      return;
    }

    /**
     * Said every time, at warn level, and never suppressed.
     *
     * A developer who has forgotten which mode they are in should find out from
     * their own terminal, not from somebody else's traffic. The config layer
     * makes this state impossible to reach in production or on a non-local
     * host, so the warning is a reminder rather than a last line of defence —
     * but it is the one a person actually reads.
     */
    if (config.authDisabled) {
      logger.warn("Authentication is DISABLED (MICA_MODE=local)", {
        note: "There is no user and no sign-in. Never expose this to a network.",
      });
    }

    logger.info("Mica CMS started", {
      url: config.MICA_PUBLIC_URL,
      listening: `${config.HOST}:${info.port}`,
      site: ctx.site.id,
      mode: config.MICA_MODE,
      environment: config.NODE_ENV,
      auth: config.authDisabled
        ? "disabled"
        : `oidc:${new URL(config.MICA_OIDC_ISSUER!).hostname}`,
      // Who may edit, in the operator's own words. Said at startup because a
      // rule that admits nobody and a rule that admits everybody look the
      // same from outside until somebody tries to sign in.
      admission: ctx.services.admission.summary,
      database: config.databasePath,
      content: connector.origin,
      // Enough to tell two deployments apart when a website was built against
      // one model and the CMS is serving another.
      schema: schemaOrigin(connector),
      schemaFingerprint: fingerprint,
      collections: Object.keys(model.collections).length,
    });
  });

  /**
   * A busy port is the most likely way a first run fails, and `EADDRINUSE` on
   * its own says neither which port nor what to do instead.
   */
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") throw error;

    process.stderr.write(
      portInUse(config.PORT, config.HOST, supportsColor(process.stderr, process.env)),
    );
    process.exit(1);
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

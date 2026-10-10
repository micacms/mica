/**
 * The self-hosted deployment's process entry point — what the Docker image
 * runs.
 *
 * The whole composition: the runtime behind the OIDC gate from
 * `@micacms/auth-oidc`, a repository connector built from the environment,
 * and — behind a provider repository only — one SQLite database holding the
 * draft store. Sessions are cookies and need no storage. It composes `@micacms/runtime`; it does not
 * fork it.
 */

import fs from "node:fs";

import { createOidcAuth } from "@micacms/auth-oidc";
import { MANIFEST_PATH } from "@micacms/core";
import {
  ConfigError,
  createApp,
  createConnector,
  createLogger,
  createRuntimeContext,
  loadSchema,
  SchemaError,
  schemaFingerprint,
  schemaOrigin,
  startServer,
} from "@micacms/runtime";

import { editorUiDist } from "./admin-dir.js";
import { loadConfig } from "./config.js";
import { createDraftRepository } from "./db/drafts.js";
import { openDatabase } from "./db/index.js";
import { databaseVersion } from "./db/migrations.js";

/** Size on disk including the WAL, or null for an in-memory database. */
function databaseBytes(filename: string): number | null {
  const size = (name: string): number | null => {
    try {
      return fs.statSync(name).size;
    } catch {
      return null;
    }
  };
  const main = size(filename);
  // The WAL holds committed transactions not yet checkpointed into the main
  // file; leaving it out understates the database.
  return main === null ? null : main + (size(`${filename}-wal`) ?? 0);
}

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
  // no model of its own: the Astro project writes one into the content root
  // and the developer commits it, so reading it is a repository read.
  //
  // Which draft workspace this deployment stages in follows the connector: a
  // provider repository stages in the database, a checkout beside the server
  // stages in the checkout — see decisions.md, "Local publishing spawns the
  // `git` binary". Without a draft store there is nothing to keep, so no file.
  const db =
    config.REPOSITORY === "local" ? undefined : openDatabase(config.databasePath, { logger });
  const connector = createConnector(config);

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
  // drift gate compares against it — see decisions.md.
  const schemaRevision = await connector.revision(MANIFEST_PATH);

  if (config.devSecrets.length > 0) {
    logger.warn("Using generated development secrets", {
      missing: config.devSecrets,
      note: "Sessions end on restart. Set these before deploying.",
    });
  }

  const auth = createOidcAuth({ config, logger });

  const drafts = db && createDraftRepository(db);

  const ctx = createRuntimeContext({
    config,
    model,
    connector,
    drafts,
    schemaRevision,
    logger,

    operational: () => ({
      auth: `oidc:${new URL(config.MICA_OIDC_ISSUER!).hostname}`,
      admission: auth.admission.summary,
      database: db
        ? {
            path: config.databasePath,
            version: databaseVersion(db),
            bytes: databaseBytes(config.databasePath),
          }
        : null,
      dataDir: config.dataDir,
      sessionTtlHours: config.SESSION_TTL_HOURS,
      sessionIdleHours: config.SESSION_IDLE_HOURS,
      generatedSecrets: config.devSecrets,
    }),

    health: db ? { database: () => void db.get<{ ok: number }>("SELECT 1 AS ok") } : {},

    onShutdown: () => {
      auth.loginLimiter.stop();
      db?.close();
    },
  });

  const app = createApp(ctx, {
    auth: auth.surface,
    adminDir: config.ADMIN_DIR ?? editorUiDist(),
  });

  const fingerprint = await schemaFingerprint(model);

  startServer({
    app,
    host: config.HOST,
    port: config.PORT,
    logger,

    onListening(info) {
      logger.info("Mica CMS started", {
        url: config.MICA_PUBLIC_URL,
        listening: `${config.HOST}:${info.port}`,
        site: ctx.site.id,
        environment: config.NODE_ENV,
        auth: `oidc:${new URL(config.MICA_OIDC_ISSUER!).hostname}`,
        // Who may edit, in the operator's own words. Said at startup because a
        // rule that admits nobody and a rule that admits everybody look the
        // same from outside until somebody tries to sign in.
        admission: auth.admission.summary,
        database: db ? config.databasePath : "none",
        content: connector.origin,
        // Enough to tell two deployments apart when a website was built
        // against one model and the CMS is serving another.
        schema: schemaOrigin(connector),
        schemaFingerprint: fingerprint,
        collections: Object.keys(model.collections).length,
      });
    },

    shutdown: () => ctx.shutdown(),
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

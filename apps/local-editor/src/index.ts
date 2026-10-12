/**
 * The local editor's process entry point: the developer's checkout, the
 * auth-neutral runtime and the Host allowlist. It writes nothing outside the
 * content directory and installs no auth code that can be misconfigured.
 */

import { MANIFEST_PATH } from "@micacms/core";
import {
  ConfigError,
  contentFiles,
  createApp,
  createLogger,
  createRuntimeContext,
  loadSchema,
  SchemaError,
  schemaFingerprint,
  schemaOrigin,
  startServer,
  VERSION,
} from "@micacms/runtime";

import { editorUiDist } from "./admin-dir.js";
import { portInUse, startupBanner, supportsColor } from "./banner.js";
import { loadConfig } from "./config.js";
import { hostGuard } from "./guards.js";
import { openInBrowser } from "./open.js";

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

  const logger = createLogger({ level: config.LOG_LEVEL, pretty: true });

  // A bad or absent model is a project mistake, not a crash: exit like a bad
  // environment, without a stack trace.
  const files = contentFiles({ root: config.contentRoot });

  let model;
  try {
    model = await loadSchema(files);
  } catch (error) {
    if (error instanceof SchemaError) {
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const schemaRevision = await files.revision(MANIFEST_PATH);

  const ctx = createRuntimeContext({
    config,
    model,
    files,
    schemaRevision,
    logger,
    operational: () => ({
      auth: "none — the local editor has no accounts and no sign-in",
    }),
  });

  const app = createApp(ctx, {
    guards: [hostGuard()],
    adminDir: config.ADMIN_DIR ?? editorUiDist(),
  });

  const fingerprint = await schemaFingerprint(model);

  startServer({
    app,
    host: config.HOST,
    port: config.PORT,
    logger,

    onListening() {
      // A person at a terminal gets a short banner; a log collector gets every field.
      if (config.MICA_CLI) {
        const useColor = supportsColor(process.stdout, process.env);

        process.stdout.write(
          startupBanner(
            {
              version: VERSION,
              url: config.MICA_PUBLIC_URL,
              contentRoot: files.origin,
              collections: Object.keys(model.collections).length,
              singletons: Object.keys(model.singletons).length,
            },
            useColor,
          ),
        );

        if (config.MICA_OPEN) openInBrowser(`${config.MICA_PUBLIC_URL}/admin/`);
        return;
      }

      logger.info("Mica local editor started", {
        url: config.MICA_PUBLIC_URL,
        listening: `${config.HOST}:${config.PORT}`,
        auth: "none (local editor; loopback only)",
        content: files.origin,
        schema: schemaOrigin(files),
        schemaFingerprint: fingerprint,
        collections: Object.keys(model.collections).length,
      });
    },

    portInUseMessage: () =>
      portInUse(config.PORT, config.HOST, supportsColor(process.stderr, process.env)),

    shutdown: () => ctx.shutdown(),
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

/**
 * The local editor's process entry point: the developer's checkout, the
 * auth-neutral runtime and the Host allowlist. It writes nothing outside the
 * content directory and installs no auth code that can be misconfigured.
 */

import { MANIFEST_PATH } from "@micacms/core/internal";
import {
  ConfigError,
  contentFiles,
  createApp,
  createLogger,
  createRuntimeContext,
  detachedHead,
  loadSchema,
  locateTree,
  SchemaError,
  schemaFingerprint,
  schemaOrigin,
  startServer,
  VERSION,
  type DetachedHead,
} from "@micacms/runtime";

import { mcpRoutes } from "@micacms/mcp";

import { editorUiDist } from "./admin-dir.js";
import { developerPolicy } from "./developer.js";
import { devServerPreview } from "./preview.js";
import { portInUse, startupBanner, supportsColor } from "./banner.js";
import { loadConfig } from "./config.js";
import { hostGuard } from "./guards.js";
import { lfsSetupProblem } from "./lfs.js";
import { openInBrowser } from "./open.js";
import { removeStaleTemporaries } from "./temporaries.js";

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

  const lfs = await lfsSetupProblem(config.contentRoot);
  if (lfs) {
    process.stderr.write(`\n${lfs}\n\n`);
    process.exit(78); // EX_CONFIG
  }

  const logger = createLogger({ level: config.MICA_LOG_LEVEL, pretty: true });

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

  const removed = await removeStaleTemporaries(config.contentRoot);
  if (removed.length > 0) logger.info("Removed temporary files of an earlier Mica", { paths: removed });

  const ctx = createRuntimeContext({
    config,
    model,
    files,
    schemaRevision,
    logger,
    operational: () => ({
      auth: "none — the local editor has no accounts and no sign-in",
    }),
    policy: developerPolicy({ publishEnabled: config.MICA_LOCAL_PUBLISH, logger }),
    preview: devServerPreview(config.contentRoot),
  });

  const app = createApp(ctx, {
    guards: [hostGuard()],
    adminDir: config.MICA_ADMIN_DIR ?? editorUiDist(),
    // No gate, as for the editor: loopback only, behind the Host allowlist.
    routes: [mcpRoutes(ctx, { publish: config.MICA_MCP_PUBLISH, localFiles: true })],
  });

  const fingerprint = await schemaFingerprint(model);
  const detached = config.MICA_LOCAL_PUBLISH ? await detachedCheckout(config.contentRoot) : null;

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
              ...(detached ? { detached: { submodule: detached.superproject !== null, command: detached.command } } : {}),
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
      if (detached) {
        logger.warn("Publish waits: the content repository is on a detached HEAD", {
          repository: detached.repository,
          submoduleOf: detached.superproject,
          command: detached.command,
        });
      }
    },

    portInUseMessage: () =>
      portInUse(config.PORT, config.HOST, supportsColor(process.stderr, process.env)),

    shutdown: () => ctx.shutdown(),
  });
}

/** The content repository on a detached HEAD, as a submodule usually is; null on a branch or outside Git. */
async function detachedCheckout(contentRoot: string): Promise<DetachedHead | null> {
  const tree = await locateTree(contentRoot);
  return "reason" in tree ? null : detachedHead(tree);
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

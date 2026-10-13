/**
 * The Docker entry point: the runtime behind the OIDC gate, on a Git clone on
 * the data volume. The order at start: `/health` answers first, then the clone
 * is made and synced, and only then is the model read, so a restart applies a
 * model change that a sync held back.
 */

import { createOidcAuth } from "@micacms/auth-oidc";
import { MANIFEST_PATH, type Site } from "@micacms/core";
import {
  ConfigError,
  contentFiles,
  createApp,
  createLogger,
  createRuntimeContext,
  createWorkspaceLocks,
  GitError,
  loadSchema,
  SchemaError,
  schemaFingerprint,
  startServer,
  type ContentFiles,
  type Env,
  type Logger,
  type RuntimeContext,
} from "@micacms/runtime";
import { Hono } from "hono";

import { editorUiDist } from "./admin-dir.js";
import { runCheck } from "./check.js";
import { loadConfig, type SelfHostedConfig } from "./config.js";
import { cloneLayout, CloneRefusal, openClone } from "./workspace/clone.js";
import { coarseGroups, contentGroups, revalidator } from "./workspace/content-groups.js";
import { redact } from "./workspace/credentials.js";
import { classifyFailure, describeFailure } from "./workspace/failures.js";
import { managedEnvironment } from "./workspace/isolation.js";
import { createManagedWorkspace, type ManagedWorkspace } from "./workspace/managed.js";

const EX_USAGE = 64;
const EX_CONFIG = 78;

/** Stops the process with a message for the operator, not a stack trace. */
function refuse(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(EX_CONFIG);
}

/**
 * The app the server runs from the first second: `/health` answers at once,
 * `/ready` says "cloning", and everything else waits for the real app.
 */
function createDispatcher() {
  const starting = new Hono<Env>();
  starting.get("/health", (c) => c.json({ status: "ok" }));
  starting.get("/ready", (c) => c.json({ status: "error", repository: "unavailable", reasons: ["cloning"] }, 503));
  starting.all("*", (c) => c.json({ error: { code: "unavailable", message: "Mica is starting." } }, 503));

  let current: Hono<Env> = starting;
  const app = new Hono<Env>();
  app.all("*", (c) => current.fetch(c.req.raw, c.env));
  return { app, serve: (next: Hono<Env>) => void (current = next) };
}

async function readModel(config: SelfHostedConfig, files: ContentFiles): Promise<Site> {
  try {
    return await loadSchema(files);
  } catch (error) {
    if (error instanceof SchemaError) {
      refuse(
        `${error.message}\n  (Repository ${config.repository.remote.url}, branch ${config.repository.branch}, ` +
          `content root ${config.repository.root || "/"}.)`,
      );
    }
    throw error;
  }
}

async function serve(): Promise<void> {
  let config: SelfHostedConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) refuse(error.message);
    throw error;
  }

  const logger: Logger = createLogger({ level: config.MICA_LOG_LEVEL, pretty: !config.isProduction });
  const { remote, branch, root, token, username, syncSeconds } = config.repository;
  const clean = (text: string) => redact(text, [token]);
  const authLabel = `oidc:${new URL(config.MICA_OIDC_ISSUER!).hostname}`;

  if (config.devSecrets.length > 0) {
    logger.warn("Using generated development secrets", {
      missing: config.devSecrets,
      note: "Sessions end on restart. Set these before deploying.",
    });
  }
  if (config.unknownVariables.length > 0) {
    logger.warn("Unknown configuration variables", {
      names: config.unknownVariables,
      note: "Nothing reads these. Check the spelling against deploy/self-hosted/.env.example.",
    });
  }

  const dispatcher = createDispatcher();
  let ctx: RuntimeContext | null = null;
  let managed: ManagedWorkspace | null = null;

  startServer({
    app: dispatcher.app,
    host: config.HOST,
    port: config.PORT,
    logger,
    onListening(info) {
      logger.info("Listening", { listening: `${config.HOST}:${info.port}`, url: config.MICA_PUBLIC_URL });
    },
    shutdown: async () => {
      managed?.stop();
      await ctx?.shutdown();
    },
  });

  const layout = cloneLayout(config.dataDir);
  const env = managedEnvironment({ remote, cloneDir: layout.repositoryDir, username, token });
  let git;
  try {
    git = await openClone({ layout, url: remote.url, branch, root, env, logger });
  } catch (error) {
    if (error instanceof CloneRefusal) refuse(error.message);
    if (error instanceof GitError) {
      refuse(
        `Could not clone ${remote.url} (branch ${branch}): ${describeFailure(classifyFailure(error.stderr))}\n` +
          `  ${clean(error.stderr.trim())}`,
      );
    }
    throw error;
  }

  const tree = { git, prefix: root, contentRoot: config.contentRoot };
  const files = contentFiles({ root: config.contentRoot });
  const locks = createWorkspaceLocks();

  // The model at HEAD groups the files for the first sync, and is read again
  // after it. Only the second read may stop the start: a model this image
  // cannot read must not block the fetch of a fix.
  const startModel = await loadSchema(files).catch((error: unknown) => {
    if (!(error instanceof SchemaError)) throw error;
    logger.warn("The content model at the clone's head cannot be read; syncing with a coarse grouping", {
      message: error.message,
    });
    return null;
  });
  const groups = { of: startModel ? contentGroups(startModel) : coarseGroups };
  const revalidate = {
    run: startModel ? revalidator(startModel, files, tree) : async (_paths: string[]) => {},
  };

  managed = createManagedWorkspace({
    layout,
    url: remote.url,
    git,
    tree,
    branch,
    root,
    locks,
    logger,
    groupOf: (path) => groups.of(path),
    revalidate: (paths) => revalidate.run(paths),
    secrets: [token],
    syncSeconds,
  });

  let synced;
  try {
    synced = await managed.sync({ skipHold: true });
  } catch (error) {
    if (error instanceof CloneRefusal) refuse(error.message);
    throw error;
  }
  if (synced.error) {
    // A clone is in place, so editing works; Mica keeps trying.
    logger.warn("Starting without a fresh sync", { code: synced.error.code, message: synced.error.message });
  }

  const model = await readModel(config, files);
  groups.of = contentGroups(model);
  revalidate.run = revalidator(model, files, tree);
  const schemaRevision = await files.revision(MANIFEST_PATH);

  const write = await managed.checkWrite();
  const writeCheck =
    write.kind === "pushed"
      ? "ok"
      : write.kind === "failed"
        ? `failed: ${describeFailure(write.failure)}`
        : `refused: ${clean(write.kind === "remote-rejected" ? write.reason : "non-fast-forward")}`;
  if (write.kind !== "pushed") logger.warn("The write check did not pass; Publish will fail", { writeCheck });

  const auth = createOidcAuth({ config, logger });
  const workspace = managed;

  ctx = createRuntimeContext({
    config,
    model,
    files,
    schemaRevision,
    logger,
    policy: workspace.policy,
    locks,
    tree,

    operational: () => ({
      auth: authLabel,
      admission: auth.admission.summary,
      dataDir: config.dataDir,
      sessionTtlHours: config.MICA_SESSION_TTL_HOURS,
      sessionIdleHours: config.MICA_SESSION_IDLE_HOURS,
      generatedSecrets: config.devSecrets,
    }),

    health: {
      // Editing works as long as the clone is there; these are reasons to look.
      ready: () => {
        const state = workspace.state();
        const reasons: string[] = [];
        if (state.error) {
          reasons.push(
            state.error.code === "auth" ? "auth_failed" : state.error.code === "write_forbidden" ? "write_forbidden" : "sync_failing",
          );
        }
        if (state.restartRequired) reasons.push("restart_required");
        return { ok: true, reasons };
      },
    },

    onShutdown: () => {
      auth.loginLimiter.stop();
    },
  });

  dispatcher.serve(
    createApp(ctx, {
      auth: auth.surface,
      adminDir: config.MICA_ADMIN_DIR ?? editorUiDist(),
    }),
  );
  workspace.start();

  logger.info("Mica CMS started", {
    url: config.MICA_PUBLIC_URL,
    site: ctx.site.id,
    environment: config.NODE_ENV,
    auth: authLabel,
    // A rule that admits nobody and one that admits everybody look the same
    // until somebody signs in.
    admission: auth.admission.summary,
    repository: remote.url,
    branch,
    root: root || "/",
    head: workspace.state().head,
    writeCheck,
    // Shows when a website was built against a different model than the CMS serves.
    schemaFingerprint: await schemaFingerprint(model),
    collections: Object.keys(model.collections).length,
  });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "check") process.exit(await runCheck());
  if (command !== undefined && command !== "serve") {
    process.stderr.write(`Unknown command "${command}". Use no command to serve, or "check".\n`);
    process.exit(EX_USAGE);
  }
  await serve();
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

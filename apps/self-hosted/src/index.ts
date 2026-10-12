/**
 * The self-hosted deployment's process entry point — what the Docker image
 * runs.
 *
 * The whole composition: the runtime behind the OIDC gate from
 * `@micacms/auth-oidc`, working on a clone of the content repository that
 * this process keeps on its data volume. The working tree is the draft
 * workspace; there is no database. It composes `@micacms/runtime`; it does
 * not fork it.
 *
 * The order at start matters (decisions.md, "Start, readiness and check"):
 * the HTTP server answers `/health` first, then the clone is made or
 * recovered, brought up to date, and only then is the content model read —
 * so a restart is what applies a model change that a sync held back.
 *
 *   node dist/index.js          serve
 *   node dist/index.js check    check the configuration and the repository, then exit
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
import { contentGroups, revalidator } from "./workspace/content-groups.js";
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

  const logger: Logger = createLogger({ level: config.LOG_LEVEL, pretty: !config.isProduction });
  const { remote, branch, root, token, username, syncSeconds } = config.repository;
  const clean = (text: string) => redact(text, [token]);

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

  /* ------------------------------------------------------------ the clone */

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

  // The model at HEAD tells the first sync which files belong together. The
  // sync at start may move HEAD past a model change, so it is read again.
  let model = await readModel(config, files);
  const groups = { of: contentGroups(model) };
  const revalidate = { run: revalidator(model, files, tree) };

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

  model = await readModel(config, files);
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

  /* -------------------------------------------------------------- the app */

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
      auth: `oidc:${new URL(config.MICA_OIDC_ISSUER!).hostname}`,
      admission: auth.admission.summary,
      database: null,
      dataDir: config.dataDir,
      sessionTtlHours: config.SESSION_TTL_HOURS,
      sessionIdleHours: config.SESSION_IDLE_HOURS,
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
      adminDir: config.ADMIN_DIR ?? editorUiDist(),
    }),
  );
  workspace.start();

  logger.info("Mica CMS started", {
    url: config.MICA_PUBLIC_URL,
    site: ctx.site.id,
    environment: config.NODE_ENV,
    auth: `oidc:${new URL(config.MICA_OIDC_ISSUER!).hostname}`,
    // Who may edit, in the operator's own words. Said at startup because a
    // rule that admits nobody and a rule that admits everybody look the same
    // from outside until somebody tries to sign in.
    admission: auth.admission.summary,
    repository: remote.url,
    branch,
    root: root || "/",
    head: workspace.state().head,
    writeCheck,
    // Enough to tell two deployments apart when a website was built against
    // one model and the CMS is serving another.
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

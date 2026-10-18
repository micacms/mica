/**
 * The Docker entry point: the runtime behind the OIDC gate, on a Git clone on
 * the data volume. The order at start: `/health` answers first, then the clone
 * is made and synced, and only then is the model read. A later model change
 * comes in with a sync, and the runtime loads it.
 */

import { join } from "node:path";

import { createOidcAuth } from "@micacms/auth-oidc";
import { MANIFEST_PATH, memorySource, type Site } from "@micacms/core/internal";
import {
  ConfigError,
  ConflictError,
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
  type WorkspaceLocks,
} from "@micacms/runtime";
import { Hono } from "hono";

import { editorUiDist } from "./admin-dir.js";
import { agentRoutes } from "./agents.js";
import { runCheck } from "./check.js";
import { runCompact } from "./compact.js";
import { operationalInfo } from "./operational.js";
import { readiness } from "./readiness.js";
import { currentToken, loadConfig, type SelfHostedConfig } from "./config.js";
import { cloneLayout, CloneRefusal, openClone } from "./workspace/clone.js";
import { coarseGroups, contentGroups, revalidator } from "./workspace/content-groups.js";
import { redact } from "./workspace/credentials.js";
import { classifyFailure, describeFailure } from "./workspace/failures.js";
import { managedEnvironment } from "./workspace/isolation.js";
import { takeLease, type Lease } from "./workspace/lease.js";
import { createManagedWorkspace, type ManagedWorkspace } from "./workspace/managed.js";

const EX_USAGE = 64;
const EX_CONFIG = 78;

/** Stops the process with a message for the operator, not a stack trace. */
function refuse(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(EX_CONFIG);
}

/** How long a stop waits for a running sync or publication, within the server's 15 seconds. */
const SHUTDOWN_WAIT_MS = 10_000;

/** The content files, with every write refused while the clone is read-only (`SyncState.readOnly`). */
function refuseWritesWhile(files: ContentFiles, readOnly: () => string | null): ContentFiles {
  return {
    ...files,
    async apply(input, after) {
      const reason = readOnly();
      if (reason) throw new ConflictError(reason, []);
      return files.apply(input, after);
    },
  };
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

/** Whether the token may push: logged, because only Publish needs it. */
async function checkWrite(workspace: ManagedWorkspace, logger: Logger, clean: (text: string) => string): Promise<void> {
  const write = await workspace.checkWrite();
  if (write.kind === "pushed") return logger.info("The write check passed");
  const writeCheck =
    write.kind === "failed"
      ? `failed: ${describeFailure(write.failure)}`
      : `refused: ${clean(write.kind === "remote-rejected" ? write.reason : "non-fast-forward")}`;
  logger.warn("The write check did not pass; Publish will fail", { writeCheck });
}

async function readModel(config: SelfHostedConfig, files: ContentFiles): Promise<Site> {
  try {
    return await loadSchema(files);
  } catch (error) {
    if (error instanceof SchemaError) {
      refuse(
        `${error.message}\n  (Repository ${config.repository.remote.url}, branch ${config.repository.branch}, ` +
          `content root ${config.repository.root}.)`,
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

  const logger: Logger = createLogger({ level: config.MICA_LOG_LEVEL, pretty: process.stdout.isTTY === true });
  const { remote, branch, token, tokenFile, username, syncSeconds, lfsUrl } = config.repository;
  const secrets = () => [currentToken(config.repository)];
  const clean = (text: string) => redact(text, secrets());
  const authLabel = `oidc:${new URL(config.MICA_OIDC_ISSUER!).hostname}`;

  if (config.unknownVariables.length > 0) {
    logger.warn("Unknown configuration variables", {
      names: config.unknownVariables,
      note: "Nothing reads these. Check the spelling against deploy/self-hosted/.env.example.",
    });
  }

  const dispatcher = createDispatcher();
  let ctx: RuntimeContext | null = null;
  let managed: ManagedWorkspace | null = null;
  let locks: WorkspaceLocks | null = null;
  let lease: Lease | null = null;

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
      // A sync or a publication that runs now finishes, so that it leaves no Git lock behind (#229).
      if (locks) {
        const idle = Promise.all([locks.remote.run(async () => {}), locks.tree.write(async () => {})]);
        await Promise.race([idle, new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref())]);
      }
      await ctx?.shutdown();
      await lease?.release();
    },
  });

  // One Mica per volume: a second one waits for this lease to expire, then refuses.
  try {
    lease = await takeLease(config.dataDir, logger, (holder) =>
      refuse(`Another Mica took over this data volume: ${holder}. This one stops, so that only one writes to the clone.`),
    );
  } catch (error) {
    if (error instanceof CloneRefusal) refuse(error.message);
    throw error;
  }

  const layout = cloneLayout(config.dataDir);
  const env = managedEnvironment({ remote, cloneDir: layout.repositoryDir, username, token, tokenFile, lfsUrl });
  let opened;
  try {
    opened = await openClone({ layout, url: remote.url, branch, root: config.repository.root, env, logger });
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

  const { git, root } = opened;
  config = { ...config, contentRoot: join(layout.repositoryDir, root), repository: { ...config.repository, root } };
  const tree = { git, prefix: root, contentRoot: config.contentRoot };
  const files = contentFiles({ root: config.contentRoot });
  const workspaceLocks = createWorkspaceLocks();
  locks = workspaceLocks;

  // Mica starts with the model at the clone's head and syncs in the background.
  // Only without a readable model does the start wait for a sync, which may bring a fix.
  let model = await loadSchema(files).catch((error: unknown) => {
    if (!(error instanceof SchemaError)) throw error;
    logger.warn("The content model at the clone's head cannot be read; syncing first", { message: error.message });
    return null;
  });
  const groups = { of: model ? contentGroups(model) : coarseGroups };
  const revalidate = {
    run: model ? revalidator(model, files, tree) : async (_paths: string[]) => {},
  };

  managed = createManagedWorkspace({
    layout,
    url: remote.url,
    git,
    tree,
    branch,
    root,
    locks: workspaceLocks,
    logger,
    groupOf: (path) => groups.of(path),
    revalidate: (paths) => revalidate.run(paths),
    secrets,
    syncSeconds,
    // Before the runtime exists, the start reads the model after the first sync anyway.
    onModelChange: async () => {
      await ctx?.refreshModel({ force: true });
    },
    modelProblem: async (manifest) => {
      try {
        await loadSchema(memorySource({ [MANIFEST_PATH]: manifest }, "sync"));
        return null;
      } catch (error) {
        if (error instanceof SchemaError) return error.message;
        throw error;
      }
    },
  });

  if (!model) {
    const synced = await managed.sync({ skipHold: true });
    if (synced.error) logger.warn("The sync at the start failed", { code: synced.error.code, message: synced.error.message });
    model = await readModel(config, files);
    groups.of = contentGroups(model);
    revalidate.run = revalidator(model, files, tree);
  }
  const schemaRevision = await files.revision(MANIFEST_PATH);

  const auth = createOidcAuth({ config, logger });
  const workspace = managed;

  ctx = createRuntimeContext({
    config,
    model,
    files: refuseWritesWhile(files, () => workspace.state().readOnly),
    schemaRevision,
    logger,
    policy: workspace.policy,
    locks: workspaceLocks,
    tree,
    onModel: (next) => {
      groups.of = contentGroups(next);
      revalidate.run = revalidator(next, files, tree);
    },

    operational: () => operationalInfo(config, { label: authLabel, admission: auth.admission.summary }),

    health: { ready: () => readiness(workspace.state()) },

    onShutdown: () => {
      auth.loginLimiter.stop();
    },
  });

  dispatcher.serve(
    createApp(ctx, {
      auth: auth.surface,
      adminDir: editorUiDist(),
      routes: agentRoutes(config, ctx, auth, logger),
    }),
  );
  workspace.start();
  void checkWrite(workspace, logger, clean);

  logger.info("Mica CMS started", {
    url: config.MICA_PUBLIC_URL,
    site: ctx.site.id,
    auth: authLabel,
    // A rule that admits nobody and one that admits everybody look the same
    // until somebody signs in.
    admission: auth.admission.summary,
    mcp: config.MICA_MCP ? `on${config.MICA_MCP_PUBLISH ? ", with publish" : ""}` : "off",
    repository: remote.url,
    branch,
    root,
    head: workspace.state().head,
    // Shows when a website was built against a different model than the CMS serves.
    schemaFingerprint: await schemaFingerprint(model),
    collections: Object.keys(model.collections).length,
  });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "check") process.exit(await runCheck());
  if (command === "compact") process.exit(await runCompact());
  if (command !== undefined && command !== "serve") {
    process.stderr.write(`Unknown command "${command}". Use no command to serve, "check" or "compact".\n`);
    process.exit(EX_USAGE);
  }
  await serve();
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

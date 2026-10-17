/**
 * `npx mica mcp`: the Mica tools over stdio, for a coding agent that starts
 * Mica itself. The agent owns stdin and stdout, so every log line goes to
 * stderr. As for the editor: no authentication, no database, and nothing
 * written outside the content directory.
 */

import { MANIFEST_PATH } from "@micacms/core/internal";
import { serveMcpStdio } from "@micacms/mcp";
import { ConfigError, contentFiles, createLogger, createRuntimeContext, loadSchema, SchemaError, VERSION } from "@micacms/runtime";

import { agentSetup, colors, supportsColor } from "./banner.js";
import { loadConfig } from "./config.js";
import { developerPolicy } from "./developer.js";
import { lfsSetupProblem } from "./lfs.js";

/** A project mistake, not a crash: said on stderr, without a stack trace. */
function refuse(message: string): never {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(78); // EX_CONFIG
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) refuse(error.message);
    throw error;
  }
  const lfs = await lfsSetupProblem(config.contentRoot);
  if (lfs) refuse(lfs);

  const logger = createLogger({ level: config.MICA_LOG_LEVEL, pretty: false, stderrOnly: true });
  const files = contentFiles({ root: config.contentRoot });

  let model;
  try {
    model = await loadSchema(files);
  } catch (error) {
    if (error instanceof SchemaError) refuse(error.message);
    throw error;
  }

  const ctx = createRuntimeContext({
    config,
    model,
    files,
    schemaRevision: await files.revision(MANIFEST_PATH),
    logger,
    operational: () => ({ auth: "none — the local MCP server runs as the developer, over stdio" }),
    policy: developerPolicy({ publishEnabled: config.MICA_LOCAL_PUBLISH, logger }),
  });

  const server = serveMcpStdio(ctx, { publish: config.MICA_MCP_PUBLISH, localFiles: true });
  logger.info("Mica MCP server on stdio", { content: files.origin, publish: config.MICA_MCP_PUBLISH });

  // A person at a terminal, not an agent: say how to add this command to one. On stderr, as always here.
  if (process.stdin.isTTY) process.stderr.write(howToConnect(process.argv.slice(3)));

  const stop = async () => {
    await server.close();
    await ctx.shutdown();
    process.exit(0);
  };
  // The agent closes stdin when its session ends.
  process.stdin.on("end", () => void stop());
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

/** The agent configuration for this command, with the options it was started with. */
function howToConnect(options: string[]): string {
  const useColor = supportsColor(process.stderr, process.env);
  const c = colors(useColor);
  return [
    "",
    `  ${c.brand("◆")} ${c.bold("Mica")} ${c.dim(VERSION)} ${c.dim("— the tools for coding agents, over stdio")}`,
    "",
    `  ${c.dim("An agent starts this command itself. Add it to your agent:")}`,
    ...agentSetup({ args: ["mica", "mcp", ...options] }, useColor),
    "",
    `  ${c.dim("With the editor open, use the /mcp address that npx mica start shows instead.")}`,
    `  ${c.dim("This process now waits for an agent on stdin. Ctrl+C stops it.")}`,
    "",
    "",
  ].join("\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});

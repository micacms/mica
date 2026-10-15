/**
 * `mica mcp`: the tools over stdio, for an agent that starts Mica itself. No
 * gate: the process runs as the developer, and has no network surface.
 */

import type { RuntimeContext } from "@micacms/runtime";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { createMcpServer, type McpOptions } from "./server.js";

export function serveMcpStdio(ctx: RuntimeContext, options: McpOptions): StdioServerHandle {
  return serveStdio(() => createMcpServer(ctx, options), {
    onerror: (error) => ctx.logger.warn("MCP connection error", { message: error.message }),
  });
}

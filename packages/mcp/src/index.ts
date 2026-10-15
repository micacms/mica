/**
 * @micacms/mcp: Mica's tools for agents, over the Model Context Protocol.
 *
 * One set of tools on the runtime's services, and two transports: stdio for an
 * agent that starts `mica mcp`, and `/mcp` over HTTP in the local editor and in
 * the image. It has no authentication of its own: the composing app puts a gate
 * in front of `/mcp`.
 */

export { mcpRoutes, MCP_PATH, type McpRoutesOptions } from "./http.js";
export { describeModel, VALUE_FORMATS } from "./model.js";
export { createMcpServer, SCOPES, type Caller, type McpOptions } from "./server.js";
export { serveMcpStdio } from "./stdio.js";

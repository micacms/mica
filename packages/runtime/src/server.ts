/**
 * Binds the app to a socket and shuts down cleanly on SIGTERM and SIGINT. Each
 * app keeps its own startup message.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { getRequestListener } from "@hono/node-server";
import type { Hono } from "hono";

import type { Env } from "./http.js";
import type { Logger } from "./lib/logger.js";

/** Requests for another host name on the same port, such as the self-hosted preview's gate: they never reach the app. */
export interface BesideTheApp {
  handles(request: IncomingMessage): boolean;
  request(request: IncomingMessage, response: ServerResponse): void;
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
  /** Ends its open connections, such as WebSockets: the server's close waits for them. */
  close(): void;
}

/**
 * The HTTP server of an app: the requests for the host name of what is beside
 * it go there, all others to the app. Only what is beside the app takes an
 * upgrade; without it, Node answers an upgrade request as a plain one.
 */
export function createAppServer(app: Hono<Env>, hostname: string, beside?: BesideTheApp): Server {
  const listener = getRequestListener(app.fetch, { hostname });
  const server = createServer((request, response) => {
    if (beside?.handles(request)) beside.request(request, response);
    else void listener(request, response);
  });
  if (beside) {
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (beside.handles(request)) beside.upgrade(request, socket, head);
      else socket.destroy();
    });
  }
  return server;
}

export interface StartServerOptions {
  app: Hono<Env>;
  beside?: BesideTheApp;
  host: string;
  port: number;
  logger: Logger;
  onListening(info: { port: number }): void;
  portInUseMessage?(): string;
  shutdown(): Promise<void>;
}

export function startServer(options: StartServerOptions): void {
  const { logger } = options;

  const server = createAppServer(options.app, options.host, options.beside);
  server.listen(options.port, options.host, () => options.onListening({ port: (server.address() as AddressInfo).port }));

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EADDRINUSE") throw error;

    process.stderr.write(
      options.portInUseMessage?.() ??
        `Port ${options.port} on ${options.host} is already in use. Stop the other ` +
          `process, or set PORT.\n`,
    );
    process.exit(1);
  });

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });

    // Its open WebSockets first: else the close waits for them, and the clean shutdown below never runs.
    options.beside?.close();
    server.close(() => {
      void options.shutdown().then(() => {
        logger.info("Shutdown complete");
        process.exit(0);
      });
    });

    // A hung connection must not block a container restart.
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

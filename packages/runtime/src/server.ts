/**
 * Binds the app to a socket and shuts down cleanly on SIGTERM and SIGINT. Each
 * app keeps its own startup message.
 */

import { serve } from "@hono/node-server";
import type { Hono } from "hono";

import type { Env } from "./http.js";
import type { Logger } from "./lib/logger.js";

export interface StartServerOptions {
  app: Hono<Env>;
  host: string;
  port: number;
  logger: Logger;
  onListening(info: { port: number }): void;
  portInUseMessage?(): string;
  shutdown(): Promise<void>;
}

export function startServer(options: StartServerOptions): void {
  const { logger } = options;

  const server = serve(
    { fetch: options.app.fetch, hostname: options.host, port: options.port },
    (info) => options.onListening({ port: info.port }),
  );

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

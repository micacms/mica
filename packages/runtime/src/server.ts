/**
 * Listening, and stopping.
 *
 * The shared half of every app's entry point: bind the Hono app to a socket,
 * shut down cleanly on SIGTERM/SIGINT, and turn the one most likely first-run
 * failure — a busy port — into a message instead of a stack trace. What the
 * apps keep for themselves is what to *say* when the server is up, because
 * that is where a laptop and a container genuinely differ.
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
  /** Called once the socket is listening — the banner or the log line. */
  onListening(info: { port: number }): void;
  /** The message for a busy port. Defaults to a plain sentence. */
  portInUseMessage?(): string;
  /** Releases what the composition holds — timers, the database. */
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

    // Stop accepting connections, then release whatever the app holds.
    server.close(() => {
      void options.shutdown().then(() => {
        logger.info("Shutdown complete");
        process.exit(0);
      });
    });

    // Do not let a hung connection block a container restart indefinitely.
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

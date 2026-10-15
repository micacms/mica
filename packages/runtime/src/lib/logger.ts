/**
 * Structured logging.
 *
 * JSON lines in production so a log shipper can parse them; a compact
 * human-readable form in development.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const COLORS: Record<Exclude<LogLevel, "silent">, string> = {
  debug: "[90m",
  info: "[36m",
  warn: "[33m",
  error: "[31m",
};

export function createLogger(options: {
  level: LogLevel;
  pretty: boolean;
  bindings?: Record<string, unknown>;
  /** Every line to stderr: over MCP's stdio transport, stdout carries the protocol. */
  stderrOnly?: boolean;
}): Logger {
  const threshold = ORDER[options.level];
  const bindings = options.bindings ?? {};

  const write = (level: Exclude<LogLevel, "silent">, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < threshold) return;

    const payload = { ...bindings, ...fields };
    const stream = options.stderrOnly || level === "error" || level === "warn" ? process.stderr : process.stdout;

    if (options.pretty) {
      const extra = Object.keys(payload).length > 0 ? ` ${formatFields(payload)}` : "";
      stream.write(`${COLORS[level]}${level.padEnd(5)}[0m ${message}${extra}\n`);
      return;
    }

    stream.write(
      `${JSON.stringify({
        time: new Date().toISOString(),
        level,
        message,
        ...payload,
      })}\n`,
    );
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (extra) =>
      createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}

function formatFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => `[90m${key}=[0m${format(value)}`)
    .join(" ");
}

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

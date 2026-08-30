/**
 * Opening the database.
 *
 * Migrations are the one thing that happens before the CLI has printed
 * anything, so what they say — and at which level — is the first line a person
 * ever sees from Mica.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { openDatabase } from "../src/db/index.js";
import type { Logger } from "@micacms/runtime";

/** Records what was said and at which level, rather than writing it anywhere. */
function recordingLogger() {
  const lines: string[] = [];
  const logger: Logger = {
    debug: (message) => void lines.push(`debug: ${message}`),
    info: (message) => void lines.push(`info: ${message}`),
    warn: (message) => void lines.push(`warn: ${message}`),
    error: (message) => void lines.push(`error: ${message}`),
    child: () => logger,
  };
  return { lines, logger };
}

const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "mica-db-"));
  directories.push(directory);
  return join(directory, "cms.sqlite");
}

after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("opening the database", () => {
  it("announces the migrations it applied", () => {
    const { lines, logger } = recordingLogger();

    openDatabase(databasePath(), { logger });

    assert.ok(
      lines.some((line) => line === "info: Applied database migrations"),
      `expected an info line, got ${JSON.stringify(lines)}`,
    );
  });

  it("keeps quiet about them for the CLI, whose banner comes later", () => {
    const { lines, logger } = recordingLogger();

    openDatabase(databasePath(), { logger, quiet: true });

    // Still said, so `--log-level debug` can find it; just not to somebody who
    // has typed one command and is waiting for one address.
    assert.ok(lines.includes("debug: Applied database migrations"));
    assert.deepEqual(
      lines.filter((line) => line.startsWith("info:")),
      [],
      "nothing at info may precede the banner",
    );
  });

  it("says nothing at all when there was nothing to migrate", () => {
    const path = databasePath();
    openDatabase(path);

    const { lines, logger } = recordingLogger();
    openDatabase(path, { logger });

    assert.deepEqual(
      lines.filter((line) => !line.startsWith("debug:")),
      [],
      "a second start has no migrations to report",
    );
  });
});

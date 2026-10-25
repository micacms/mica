/** The recent problems of the System page (ADR 40): what the logger keeps, and what it hides. */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createLogger, hideEmails, recentProblems } from "../src/lib/logger.js";

describe("the recent problems", () => {
  const write = process.stderr.write.bind(process.stderr);
  const writeOut = process.stdout.write.bind(process.stdout);
  beforeEach(() => {
    // The lines go to the terminal as well; the test keeps them out of its own output.
    process.stderr.write = (() => true) as typeof process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
  });
  afterEach(() => {
    process.stderr.write = write;
    process.stdout.write = writeOut;
  });

  it("keeps the warnings and errors that a logger writes, the newest first, and no info", () => {
    const logger = createLogger({ level: "info", pretty: false }).child({ component: "test" });
    logger.info("Published", { editor: "erika@example.com" });
    logger.warn("Sync failed", { code: "network" });
    logger.error("Publish failed", { editor: "erika@example.com", detail: "x".repeat(400) });

    const [error, warning] = recentProblems();
    assert.equal(error?.level, "error");
    assert.equal(error?.fields["editor"], "(email)");
    assert.equal(error?.fields["detail"]?.length, 300);
    assert.deepEqual(warning && { ...warning, time: "" }, { time: "", level: "warn", message: "Sync failed", fields: { component: "test", code: "network" } });
    assert.equal(recentProblems().some((line) => line.message === "Published"), false);
  });

  it("keeps the last 100, and nothing of a silent logger", () => {
    const logger = createLogger({ level: "warn", pretty: true });
    for (let index = 0; index < 120; index++) logger.warn(`Warning ${index}`);
    createLogger({ level: "silent", pretty: false }).error("Silent");

    const lines = recentProblems();
    assert.equal(lines.length, 100);
    assert.equal(lines[0]?.message, "Warning 119");
    assert.equal(lines.some((line) => line.message === "Silent"), false);
  });

  it("hides email addresses, and keeps a Git address", () => {
    assert.equal(hideEmails("Refused for anna.vogt+cms@example.co.uk by the host"), "Refused for (email) by the host");
    assert.equal(hideEmails("git@github.com:acme/site.git"), "git@github.com:acme/site.git");
  });
});

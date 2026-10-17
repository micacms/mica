/** The pause that a rich-text field and the kept changes wait for, and the flush before a save. */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { debounce } from "../src/lib/debounce.js";
import { createPendingEdits } from "../src/lib/pending-edits.js";

describe("debounce", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
  afterEach(() => mock.timers.reset());

  it("runs a burst of requests once, after the pause", () => {
    let runs = 0;
    const request = debounce(() => runs++, 300);
    request();
    mock.timers.tick(200);
    request();
    mock.timers.tick(299);
    assert.equal(runs, 0);
    mock.timers.tick(1);
    assert.equal(runs, 1);
  });

  it("with leading, runs the first request at once and the rest of the burst once at the end", () => {
    let runs = 0;
    const request = debounce(() => runs++, 300, { leading: true });
    request();
    assert.equal(runs, 1);
    request();
    request();
    mock.timers.tick(300);
    assert.equal(runs, 2);
    // After the pause, the next request runs at once again.
    request();
    assert.equal(runs, 3);
  });

  it("with leading, does not run again at the end of a burst of one", () => {
    let runs = 0;
    const request = debounce(() => runs++, 300, { leading: true });
    request();
    mock.timers.tick(1000);
    assert.equal(runs, 1);
  });

  it("flushes a waiting request at once, and only once", () => {
    let runs = 0;
    const request = debounce(() => runs++, 300);
    request();
    request.flush();
    assert.equal(runs, 1);
    mock.timers.tick(1000);
    request.flush();
    assert.equal(runs, 1);
  });

  it("does nothing on a flush when no request waits", () => {
    let runs = 0;
    const request = debounce(() => runs++, 300, { leading: true });
    request.flush();
    request();
    request.flush();
    assert.equal(runs, 1);
  });

  it("drops a waiting request on cancel", () => {
    let runs = 0;
    const request = debounce(() => runs++, 300);
    request();
    request.cancel();
    mock.timers.tick(1000);
    request.flush();
    assert.equal(runs, 0);
  });
});

describe("pending edits", () => {
  it("flushes every field that holds an edit back, until it is removed", () => {
    const pending = createPendingEdits();
    const flushed: string[] = [];
    pending.add(() => flushed.push("body"));
    const remove = pending.add(() => flushed.push("intro"));
    pending.flush();
    remove();
    pending.flush();
    assert.deepEqual(flushed, ["body", "intro", "body"]);
  });
});

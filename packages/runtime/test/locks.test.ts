/**
 * The workspace locks: readers share, writers are alone, and nobody jumps the
 * queue — a waiting writer holds back the readers that arrive after it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { memorySource } from "@micacms/core";

import type { ContentFiles } from "../src/workspace/files.js";
import { createMutex, createReadWriteLock, lockedFiles } from "../src/workspace/locks.js";

/** A promise with its resolver, to hold an operation open from outside. */
function gate(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("read/write lock", () => {
  it("lets readers run together", async () => {
    const lock = createReadWriteLock();
    const held = gate();
    let running = 0;
    let most = 0;

    const reader = () =>
      lock.read(async () => {
        running += 1;
        most = Math.max(most, running);
        await held.opened;
        running -= 1;
      });

    const both = Promise.all([reader(), reader()]);
    await tick();
    held.open();
    await both;
    assert.equal(most, 2);
  });

  it("runs a writer alone, after the readers that came first", async () => {
    const lock = createReadWriteLock();
    const held = gate();
    const order: string[] = [];

    const reading = lock.read(async () => {
      order.push("read start");
      await held.opened;
      order.push("read end");
    });
    const writing = lock.write(async () => {
      order.push("write");
    });

    await tick();
    assert.deepEqual(order, ["read start"]);
    held.open();
    await Promise.all([reading, writing]);
    assert.deepEqual(order, ["read start", "read end", "write"]);
  });

  it("holds back a reader that arrives after a waiting writer", async () => {
    const lock = createReadWriteLock();
    const held = gate();
    const order: string[] = [];

    const first = lock.read(async () => {
      await held.opened;
      order.push("first read");
    });
    const writing = lock.write(async () => {
      order.push("write");
    });
    const late = lock.read(async () => {
      order.push("late read");
    });

    await tick();
    held.open();
    await Promise.all([first, writing, late]);
    assert.deepEqual(order, ["first read", "write", "late read"]);
  });

  it("releases the lock when the function throws", async () => {
    const lock = createReadWriteLock();
    await assert.rejects(lock.write(async () => Promise.reject(new Error("boom"))));
    assert.equal(await lock.write(async () => "after"), "after");
  });
});

describe("mutex", () => {
  it("runs one function at a time, in arrival order", async () => {
    const mutex = createMutex();
    const held = gate();
    const order: string[] = [];

    const first = mutex.run(async () => {
      await held.opened;
      order.push("first");
    });
    const second = mutex.run(async () => {
      order.push("second");
    });

    await tick();
    assert.deepEqual(order, []);
    held.open();
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first", "second"]);
  });
});

describe("locked files", () => {
  it("makes a save wait for a commit that holds the tree", async () => {
    const lock = createReadWriteLock();
    const source = memorySource({ "a.json": "{}" }, "memory");
    const order: string[] = [];
    const files: ContentFiles = {
      ...source,
      readBinary: async () => null,
      revision: async () => null,
      apply: async () => {
        order.push("save");
        return { revision: "r" };
      },
    };
    const locked = lockedFiles(files, lock);
    const held = gate();

    const committing = lock.write(async () => {
      await held.opened;
      order.push("commit");
    });
    const saving = locked.apply({ changes: [] });

    await tick();
    assert.deepEqual(order, []);
    held.open();
    await Promise.all([committing, saving]);
    assert.deepEqual(order, ["commit", "save"]);
  });
});

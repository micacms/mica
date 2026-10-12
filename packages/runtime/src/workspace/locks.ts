/**
 * The two locks of a working tree that several requests share.
 *
 *   - `remote` — fetch and push, one at a time.
 *   - `tree`   — a read/write lock. Reads of files and of Git's status share
 *     it; saves, discards, commits and fast-forwards hold it alone.
 *
 * Both wait rather than refuse: an autosave that arrives during a commit is
 * written after it, not rejected. An operation that needs both takes `remote`
 * first, then `tree`, so two of them can never wait on each other. No network
 * call may run while `tree` is held — a slow push must not block autosave.
 *
 * Why the tree needs a lock at all: a save during a commit could put half of
 * an entry into the commit, and Git's checkout rewrites files in place, so a
 * read during a fast-forward could see one half-written.
 */

import type { ContentFiles } from "./files.js";

/** Runs one function at a time, in arrival order. */
export interface Mutex {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** Many readers or one writer, in arrival order. A waiting writer holds back later readers. */
export interface ReadWriteLock {
  read<T>(fn: () => Promise<T>): Promise<T>;
  write<T>(fn: () => Promise<T>): Promise<T>;
}

export interface WorkspaceLocks {
  remote: Mutex;
  tree: ReadWriteLock;
}

export function createWorkspaceLocks(): WorkspaceLocks {
  return { remote: createMutex(), tree: createReadWriteLock() };
}

/** A mutex is a read/write lock that only ever writes. */
export function createMutex(): Mutex {
  const lock = createReadWriteLock();
  return { run: (fn) => lock.write(fn) };
}

export function createReadWriteLock(): ReadWriteLock {
  let readers = 0;
  let writing = false;
  const queue: Array<{ kind: "read" | "write"; start: () => void }> = [];

  const admit = (): void => {
    while (queue.length > 0) {
      const next = queue[0]!;
      if (next.kind === "write") {
        if (writing || readers > 0) return;
        queue.shift();
        writing = true;
        next.start();
        return;
      }
      if (writing) return;
      queue.shift();
      readers += 1;
      next.start();
    }
  };

  const acquire = (kind: "read" | "write"): Promise<void> =>
    new Promise((resolve) => {
      queue.push({ kind, start: resolve });
      admit();
    });

  const release = (kind: "read" | "write"): void => {
    if (kind === "write") writing = false;
    else readers -= 1;
    admit();
  };

  const hold =
    (kind: "read" | "write") =>
    async <T>(fn: () => Promise<T>): Promise<T> => {
      await acquire(kind);
      try {
        return await fn();
      } finally {
        release(kind);
      }
    };

  return { read: hold("read"), write: hold("write") };
}

/**
 * The files the services use: reads share the tree lock, writes hold it.
 *
 * The staging service does not use this wrapper. It takes the lock itself,
 * around a whole publication, and reads through the bare files inside it.
 */
export function lockedFiles(
  files: ContentFiles,
  tree: ReadWriteLock,
): ContentFiles {
  return {
    origin: files.origin,
    read: (path) => tree.read(() => files.read(path)),
    list: (path) => tree.read(() => files.list(path)),
    readBinary: (path) => tree.read(() => files.readBinary(path)),
    revision: (path) => tree.read(() => files.revision(path)),
    apply: (input) => tree.write(() => files.apply(input)),
  };
}

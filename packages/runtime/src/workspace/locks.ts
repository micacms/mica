/**
 * The two locks of a shared working tree: `remote` (fetch and push, one at a
 * time) and `tree` (read/write; saves, discards, commits and fast-forwards
 * write). A save during a commit could otherwise put half an entry into the
 * commit, and a read during a fast-forward could see a half-written file.
 *
 * Both wait, they do not refuse. Take `remote` first, then `tree`, so two
 * operations never wait on each other. No network call may run while `tree` is
 * held: a slow push must not block a save.
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
 * Files behind the tree lock. The staging service does not use it: it holds the
 * lock around whole operations.
 */
export function lockedFiles(
  files: ContentFiles,
  tree: ReadWriteLock,
): ContentFiles {
  return {
    origin: files.origin,
    read: (path) => tree.read(() => files.read(path)),
    list: (path) => tree.read(() => files.list(path)),
    readHead: (path, length) => tree.read(() => files.readHead(path, length)),
    // The stream outlives the lock; a write renames the file aside, which an open file survives.
    readStream: (path) => tree.read(() => files.readStream(path)),
    // A temporary file that nothing reads until `apply` copies it.
    receive: (path, body, limit) => files.receive(path, body, limit),
    stat: (path) => tree.read(() => files.stat(path)),
    revision: (path) => tree.read(() => files.revision(path)),
    apply: (input, after) => tree.write(() => files.apply(input, after)),
  };
}

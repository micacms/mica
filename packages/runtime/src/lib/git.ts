/**
 * Spawning the developer's own `git`.
 *
 * Deliberately the binary, not a JavaScript Git implementation. The reason is
 * credentials: a developer's push already works because of their SSH agent,
 * credential helper and remote configuration, and the spawned binary inherits
 * all three. A library would have to reimplement them, and would do it worse
 * — see decisions.md, "Local publishing spawns the `git` binary".
 *
 * `GIT_TERMINAL_PROMPT=0` because there is no terminal to answer: a push that
 * would ask for credentials must fail with Git's own message rather than hang
 * the request that triggered it.
 */

import { execFile } from "node:child_process";

export class GitError extends Error {
  override name = "GitError";
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
  }
}

export interface GitRunner {
  /** Runs `git` in the runner's directory. Trimmed stdout, or a `GitError`. */
  run(args: string[]): Promise<string>;
  /** Like `run`, but null instead of a throw — for questions Git may say no to. */
  tryRun(args: string[]): Promise<string | null>;
}

export function gitRunner(cwd: string): GitRunner {
  const run = (args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(
        "git",
        args,
        {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
            reject(
              new GitError(
                missing
                  ? "Git is not installed, or not on the PATH."
                  : firstLine(stderr) || error.message,
                stderr,
                missing ? null : ((error as { code?: number }).code ?? null),
              ),
            );
            return;
          }
          resolve(stdout.replace(/\n$/, ""));
        },
      );
    });

  return {
    run,
    async tryRun(args) {
      try {
        return await run(args);
      } catch {
        return null;
      }
    },
  };
}

/** The line a person should see first — Git puts its verdict there. */
export function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

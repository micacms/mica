/**
 * Spawning `git`.
 *
 * Deliberately the binary, not a JavaScript Git implementation. In the local
 * editor the reason is credentials: a developer's push already works because
 * of their SSH agent, credential helper and remote configuration, and the
 * spawned binary inherits all three — see decisions.md, "Local publishing
 * spawns the `git` binary". A server-owned clone passes its own environment
 * instead (`GitRunnerOptions.env`).
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
    /** What Git printed before it failed. A rejected push puts its porcelain lines here. */
    readonly stdout = "",
  ) {
    super(message);
  }
}

/** Per-call additions to a runner. */
export interface GitCallOptions {
  /** Written to Git's stdin, for `--pathspec-from-file=-` and similar. */
  input?: string;
  /** Added to the runner's environment for this call only. */
  env?: NodeJS.ProcessEnv;
}

export interface GitRunner {
  /** Runs `git` in the runner's directory. Trimmed stdout, or a `GitError`. */
  run(args: string[], call?: GitCallOptions): Promise<string>;
  /** Like `run`, but null instead of a throw — for questions Git may say no to. */
  tryRun(args: string[], call?: GitCallOptions): Promise<string | null>;
}

export interface GitRunnerOptions {
  /** The whole environment of every `git` call. Defaults to the developer's (`developerEnvironment`). */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
}

/** The developer's own environment, so their SSH agent, credential helper and configuration apply. */
export function developerEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

export function gitRunner(cwd: string, options: GitRunnerOptions = {}): GitRunner {
  const env = options.env ?? developerEnvironment();
  const run = (args: string[], call: GitCallOptions = {}): Promise<string> =>
    new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        args,
        {
          cwd,
          env: call.env ? { ...env, ...call.env } : env,
          timeout: options.timeoutMs ?? 60_000,
          maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
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
                stdout,
              ),
            );
            return;
          }
          resolve(stdout.replace(/\n$/, ""));
        },
      );
      if (call.input !== undefined) child.stdin?.end(call.input);
    });

  return {
    run,
    async tryRun(args, call) {
      try {
        return await run(args, call);
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

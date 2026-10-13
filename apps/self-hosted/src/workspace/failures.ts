/**
 * Git exits with 128 and no porcelain line for auth, permission, not-found and
 * network failures, so the class comes from stderr (with `LC_ALL=C`). The
 * network pattern is last: GitHub's and GitLab's 403 also say "unable to
 * access".
 */

export type FailureClass = "write_forbidden" | "auth" | "repo_not_found" | "branch_not_found" | "network" | "unknown";

const PATTERNS: Array<[FailureClass, RegExp]> = [
  // `clone --branch` and `fetch` say it differently.
  ["branch_not_found", /Remote branch \S+ not found|couldn't find remote ref/i],
  ["write_forbidden", /\b403\b|remote: Forbidden|not allowed to upload code/i],
  ["auth", /Authentication failed|Invalid username or token|HTTP Basic: Access denied|\b401\b/i],
  [
    "repo_not_found",
    /Repository not found|repository '[^']*' not found|could not be found or you don't have permission/i,
  ],
  ["network", /unable to access|Could not resolve host|Connection refused|timed out/i],
];

export function classifyFailure(stderr: string): FailureClass {
  for (const [kind, pattern] of PATTERNS) if (pattern.test(stderr)) return kind;
  return "unknown";
}

/** Words for the operator, by class. The editor sees a shorter message. */
export function describeFailure(kind: FailureClass): string {
  switch (kind) {
    case "write_forbidden":
      return "The token can read the repository but not write to it.";
    case "auth":
      return "The repository refused the token. It may be wrong, expired or revoked.";
    case "repo_not_found":
      return "The repository does not exist, or the token cannot see it.";
    case "branch_not_found":
      return "The branch does not exist in the repository. Check MICA_REPOSITORY_BRANCH, or push the branch first.";
    case "network":
      return "The repository cannot be reached.";
    default:
      return "Git failed.";
  }
}

export type PushOutcome =
  | { kind: "pushed" }
  | { kind: "non-fast-forward" }
  | { kind: "remote-rejected"; reason: string }
  | { kind: "failed"; failure: FailureClass };

/**
 * Reads `git push --porcelain` for one ref. The reason is in the porcelain line
 * (GitHub) or in `remote:` lines.
 */
export function readPush(exitCode: number | null, stdout: string, stderr: string): PushOutcome {
  if (exitCode === 0) return { kind: "pushed" };

  const line = stdout.split("\n").find((entry) => entry.startsWith("!"));
  if (line) {
    if (/\[rejected\] \((non-fast-forward|fetch first)\)/.test(line)) return { kind: "non-fast-forward" };
    const fromLine = /\[remote rejected\] \((.*)\)\s*$/.exec(line)?.[1] ?? "";
    const remoteLines = stderr
      .split("\n")
      .filter((entry) => entry.startsWith("remote:"))
      .map((entry) => entry.slice("remote:".length).trim().replace(/^GitLab:\s*/, ""))
      .filter((entry) => entry !== "");
    const reason = [fromLine, ...remoteLines].filter((part) => part && part !== "pre-receive hook declined");
    return { kind: "remote-rejected", reason: reason.join(" ") || fromLine || "The remote refused the push." };
  }

  return { kind: "failed", failure: classifyFailure(stderr) };
}

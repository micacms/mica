/**
 * What a failed `git` call against the remote means.
 *
 * Authentication, permission, not-found and network failures exit with 128
 * and print no porcelain line, so their class comes from stderr (with
 * `LC_ALL=C`). The order of the checks matters: GitHub's and GitLab's 403
 * messages also say "unable to access", which is the network pattern, so the
 * network check comes last. A push that reached the remote prints porcelain
 * lines on stdout instead, and those are read first.
 */

export type FailureClass = "write_forbidden" | "auth" | "repo_not_found" | "network" | "unknown";

const PATTERNS: Array<[FailureClass, RegExp]> = [
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
 * Reads `git push --porcelain` for one ref. The host's reason for a refusal is
 * in the porcelain line on GitHub, and in the `remote:` lines on GitLab and
 * Forgejo, so both are kept.
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

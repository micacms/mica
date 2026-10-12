/** The texts are the hosts' own messages. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redact } from "../src/workspace/credentials.js";
import { classifyFailure, readPush } from "../src/workspace/failures.js";

describe("classifyFailure", () => {
  it("reads a 403 as no write access, although it also says unable to access", () => {
    assert.equal(
      classifyFailure(
        "remote: You are not allowed to upload code.\nfatal: unable to access 'https://gitlab.com/a/b.git/': The requested URL returned error: 403",
      ),
      "write_forbidden",
    );
  });

  it("reads GitHub's and GitLab's authentication failures", () => {
    assert.equal(classifyFailure("remote: Invalid username or token.\nfatal: Authentication failed for 'x'"), "auth");
    assert.equal(classifyFailure("remote: HTTP Basic: Access denied.\nfatal: Authentication failed"), "auth");
  });

  it("reads a missing repository and an unreachable host", () => {
    assert.equal(classifyFailure("remote: Repository not found.\nfatal: repository 'x' not found"), "repo_not_found");
    assert.equal(
      classifyFailure("remote: The project you were looking for could not be found or you don't have permission to view it."),
      "repo_not_found",
    );
    assert.equal(classifyFailure("fatal: unable to access 'x': Could not resolve host: nowhere.invalid"), "network");
  });
});

describe("readPush", () => {
  it("reads a non-fast-forward in both of Git's spellings", () => {
    assert.equal(readPush(1, "!\tHEAD:refs/heads/main\t[rejected] (fetch first)\n", "").kind, "non-fast-forward");
    assert.equal(readPush(1, "!\tHEAD:refs/heads/main\t[rejected] (non-fast-forward)\n", "").kind, "non-fast-forward");
  });

  it("keeps the host's reason from the porcelain line or the remote lines", () => {
    const gitlab = readPush(
      1,
      "!\tHEAD:refs/heads/main\t[remote rejected] (pre-receive hook declined)\n",
      "remote: GitLab: You are not allowed to push code to protected branches on this project.        \nerror: failed to push some refs",
    );
    assert.deepEqual(gitlab, {
      kind: "remote-rejected",
      reason: "You are not allowed to push code to protected branches on this project.",
    });
    const github = readPush(1, "!\tHEAD:refs/heads/x\t[remote rejected] (refusing to allow an OAuth App to create or update workflow)\n", "");
    assert.equal(github.kind === "remote-rejected" && github.reason, "refusing to allow an OAuth App to create or update workflow");
  });

  it("classifies a failure without a porcelain line from stderr", () => {
    assert.deepEqual(readPush(128, "", "fatal: Authentication failed for 'x'"), { kind: "failed", failure: "auth" });
  });
});

describe("redact", () => {
  it("removes credentials from URLs and every secret", () => {
    assert.equal(
      redact("fatal: https://oauth2:glpat-secret@gitlab.com/a.git and glpat-secret again", ["glpat-secret"]),
      "fatal: https://gitlab.com/a.git and *** again",
    );
  });
});

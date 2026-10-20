/** A configuration that cannot work must stop the start, not fail later when an editor saves. */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ConfigError, runtimeEnv } from "@micacms/runtime";

import { currentToken, KNOWN, loadConfig } from "../src/config.js";

/** A valid environment; tests subtract from it. */
const base: NodeJS.ProcessEnv = {
  MICA_LOG_LEVEL: "silent",
  MICA_PUBLIC_URL: "https://cms.example.com",
  MICA_SESSION_SECRET: "0".repeat(32),
  MICA_DATA_DIR: "/tmp/mica-test-unused",
  MICA_OIDC_ISSUER: "https://auth.example.com",
  MICA_OIDC_CLIENT_ID: "mica",
  MICA_ADMIT_GROUPS: "mica-editors",
  MICA_REPOSITORY_URL: "https://gitlab.com/acme/site.git",
  MICA_REPOSITORY_TOKEN: "secret",
};

/** Asserts a startup refusal whose message matches every pattern. */
function refuses(env: NodeJS.ProcessEnv, ...patterns: RegExp[]): void {
  assert.throws(() => loadConfig(env), (error: unknown) => {
    assert.ok(error instanceof ConfigError);
    for (const pattern of patterns) assert.match(error.message, pattern);
    return true;
  });
}

describe("public URL", () => {
  it("refuses plain HTTP to another machine, whatever NODE_ENV says", () => {
    for (const NODE_ENV of ["production", "development"]) {
      refuses({ ...base, NODE_ENV, MICA_PUBLIC_URL: "http://cms.example.com" }, /https:\/\//);
    }
  });

  it("accepts https, and plain HTTP on this machine for a trial", () => {
    for (const url of ["https://cms.example.com", "http://localhost:6422", "http://127.0.0.1:6422"]) {
      assert.equal(loadConfig({ ...base, MICA_PUBLIC_URL: url }).MICA_PUBLIC_URL, url);
    }
  });

  it("is an origin: a trailing slash goes, a path is refused", () => {
    assert.equal(loadConfig({ ...base, MICA_PUBLIC_URL: "https://cms.example.com/" }).MICA_PUBLIC_URL, "https://cms.example.com");
    assert.throws(() => loadConfig({ ...base, MICA_PUBLIC_URL: "https://example.com/cms" }), /must be an origin/);
  });

  it("refuses a missing public URL, whose default is localhost", () => {
    const missing = { ...base };
    delete missing["MICA_PUBLIC_URL"];
    refuses(missing, /MICA_PUBLIC_URL is not set/);
  });
});

describe("live preview", () => {
  const preview = { ...base, MICA_PREVIEW_URL: "https://preview.cms.example.com", MICA_PREVIEW_UPSTREAM: "http://preview:4321" };

  it("takes an origin of its own and the dev server in the network, on a port of its own", () => {
    const config = loadConfig(preview);
    assert.equal(config.MICA_PREVIEW_URL, "https://preview.cms.example.com");
    assert.equal(config.MICA_PREVIEW_PORT, 6423);
  });

  it("takes plain HTTP on this machine for a trial, with two names under localhost", () => {
    const trial = loadConfig({ ...preview, MICA_PUBLIC_URL: "http://cms.localhost:6422", MICA_PREVIEW_URL: "http://preview.cms.localhost:6423" });
    assert.equal(trial.MICA_PREVIEW_URL, "http://preview.cms.localhost:6423");
  });

  it("needs both addresses, or neither", () => {
    refuses({ ...base, MICA_PREVIEW_URL: "https://preview.cms.example.com" }, /go together/);
    refuses({ ...base, MICA_PREVIEW_UPSTREAM: "http://preview:4321" }, /go together/);
  });

  it("refuses the editor's host, also on another port, a path, plain HTTP to another machine, and the editor's port", () => {
    refuses({ ...preview, MICA_PREVIEW_URL: "https://cms.example.com" }, /another host name than MICA_PUBLIC_URL/);
    refuses({ ...preview, MICA_PREVIEW_URL: "https://cms.example.com:8443" }, /another host name than MICA_PUBLIC_URL/);
    refuses({ ...preview, MICA_PUBLIC_URL: "http://localhost:6422", MICA_PREVIEW_URL: "http://localhost:6423" }, /another host name/);
    refuses({ ...preview, MICA_PREVIEW_URL: "https://preview.cms.example.com/site" }, /origin with no path/);
    refuses({ ...preview, MICA_PREVIEW_URL: "http://preview.cms.example.com" }, /needs https/);
    refuses({ ...preview, MICA_PREVIEW_UPSTREAM: "https://preview:4321" }, /http:\/\/ address of the dev server/);
    refuses({ ...preview, MICA_PREVIEW_PORT: "6422" }, /port of its own/);
  });
});

describe("the configuration reference", () => {
  it("names every variable that the image or the local editor reads", () => {
    const reference = readFileSync(
      join(import.meta.dirname, "../../../sites/micacms/content/docs/configuration/body.mdoc"),
      "utf8",
    );
    const missing = [...new Set([...KNOWN, ...Object.keys(runtimeEnv)])].filter((name) => !reference.includes(`\`${name}\``));
    assert.deepEqual(missing, []);
  });
});

describe("unknown variables", () => {
  it("names MICA_ variables that nothing reads, and only those", () => {
    const config = loadConfig({
      ...base,
      MICA_ADMIT_GRUOPS: "typo-for-groups",
      MICA_OIDC_ISSUER: "https://auth.example.com",
      UNRELATED_VARIABLE: "x",
    });
    assert.deepEqual(config.unknownVariables, ["MICA_ADMIT_GRUOPS"]);
  });
});

describe("repository configuration", () => {
  it("clones into the data directory, with defaults that keep a token away from the site's source", () => {
    const config = loadConfig({ ...base, MICA_CONTENT_PATH: "content" });
    assert.equal(config.repository.branch, "main");
    assert.equal(config.repository.remote.hostKey, "gitlab.com");
    assert.equal(config.contentRoot, join("/tmp/mica-test-unused", "repository", "content"));
  });

  it("chooses the username by host", () => {
    const username = (url: string) => loadConfig({ ...base, MICA_REPOSITORY_URL: url }).repository.username;
    assert.equal(username("https://gitlab.com/acme/site.git"), "oauth2");
    assert.equal(username("https://github.com/acme/site.git"), "x-access-token");
    assert.equal(username("https://git.example.com/acme/site.git"), "mica");
    assert.equal(loadConfig({ ...base, MICA_REPOSITORY_USERNAME: "bot" }).repository.username, "bot");
  });

  it("requires the URL and the token", () => {
    refuses({ ...base, MICA_REPOSITORY_URL: "", MICA_REPOSITORY_TOKEN: "" }, /MICA_REPOSITORY_URL is not set/, /MICA_REPOSITORY_TOKEN is not set/);
  });

  it("refuses credentials in the URL", () => {
    refuses({ ...base, MICA_REPOSITORY_URL: "https://oauth2:glpat-x@gitlab.com/acme/site.git" }, /contains credentials/);
  });

  it("refuses plain HTTP to another machine, SSH, and anything but https", () => {
    for (const url of ["http://gitlab.com/acme/site.git", "git@gitlab.com:acme/site.git", "file:///srv/site.git"]) {
      refuses({ ...base, MICA_REPOSITORY_URL: url }, /MICA_REPOSITORY_URL/);
    }
  });

  it("accepts plain HTTP on this machine, for the tests and a local trial", () => {
    const config = loadConfig({ ...base, MICA_REPOSITORY_URL: "http://127.0.0.1:3000/site.git" });
    assert.equal(config.repository.remote.scheme, "http");
  });

  it("reads the token from a file for each call, so a short-lived token can change", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mica-token-")), "token");
    writeFileSync(file, "first\n");
    const env: NodeJS.ProcessEnv = { ...base, MICA_REPOSITORY_TOKEN_FILE: file };
    delete env["MICA_REPOSITORY_TOKEN"];
    const config = loadConfig(env);
    assert.equal(currentToken(config.repository), "first");
    writeFileSync(file, "second\n");
    assert.equal(currentToken(config.repository), "second");

    refuses({ ...base, MICA_REPOSITORY_TOKEN_FILE: file }, /both set/);
    refuses({ ...env, MICA_REPOSITORY_TOKEN_FILE: "/nonexistent/token" }, /cannot be read/);
  });

  it("refuses a branch name Git would read as something else, and a content path outside the repository", () => {
    refuses({ ...base, MICA_REPOSITORY_BRANCH: "--upload-pack=x" }, /not a branch name/);
    refuses({ ...base, MICA_CONTENT_PATH: "../etc" }, /must name a directory in the repository/);
    refuses({ ...base, MICA_CONTENT_PATH: "/" }, /must name a directory in the repository/);
  });

  it("finds the content root in the clone unless MICA_CONTENT_PATH names it", () => {
    assert.equal(loadConfig({ ...base }).repository.root, null);
    assert.equal(loadConfig({ ...base, MICA_CONTENT_PATH: "/site/content/" }).repository.root, "site/content");
  });

});

describe("authentication", () => {
  it("binds every interface by default — a container has to", () => {
    assert.equal(loadConfig({ ...base }).HOST, "0.0.0.0");
  });

  it("requires an identity provider", () => {
    const withoutOidc = { ...base };
    delete withoutOidc["MICA_OIDC_ISSUER"];
    delete withoutOidc["MICA_OIDC_CLIENT_ID"];

    assert.throws(() => loadConfig(withoutOidc), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /MICA_OIDC_ISSUER and MICA_OIDC_CLIENT_ID/);
      assert.match(error.message, /\/api\/auth\/callback/);
      return true;
    });
  });

  it("does not require a client secret, so a public PKCE client works", () => {
    assert.doesNotThrow(() => loadConfig({ ...base }));
  });

  it("requires the session secret, also for a trial", () => {
    const missing: NodeJS.ProcessEnv = { ...base, MICA_PUBLIC_URL: "http://localhost:6422" };
    delete missing["MICA_SESSION_SECRET"];
    assert.throws(() => loadConfig(missing), /MICA_SESSION_SECRET/);
  });

  it("reads the session secret and the client secret from files", () => {
    const dir = mkdtempSync(join(tmpdir(), "mica-secrets-"));
    writeFileSync(join(dir, "session"), "s".repeat(40) + "\n");
    writeFileSync(join(dir, "client"), "client-secret\n");
    const env: NodeJS.ProcessEnv = { ...base, MICA_SESSION_SECRET_FILE: join(dir, "session"), MICA_OIDC_CLIENT_SECRET_FILE: join(dir, "client") };
    delete env["MICA_SESSION_SECRET"];
    const config = loadConfig(env);
    assert.equal(config.sessionSecret, "s".repeat(40));
    assert.equal(config.MICA_OIDC_CLIENT_SECRET, "client-secret");
    refuses({ ...env, MICA_SESSION_SECRET: "0".repeat(32) }, /both set/);
  });

  /** A remote issuer over HTTP would give the ID token to anybody on the path. */
  it("permits insecure discovery only for a provider on this machine", () => {
    const local = loadConfig({
      ...base,
      MICA_OIDC_ISSUER: "http://localhost:8080/realms/mica",
    });
    assert.equal(local.oidcAllowInsecure, true);

    const remote = loadConfig({ ...base, MICA_OIDC_ISSUER: "http://auth.example.com" });
    assert.equal(remote.oidcAllowInsecure, false);
  });
});

/**
 * No admission rule is an error, not a default: admitting everybody makes a
 * public CMS, and admitting nobody looks fine until the first person signs in.
 */
describe("who may edit", () => {
  const withoutRules = () => {
    const env = { ...base };
    delete env["MICA_ADMIT_GROUPS"];
    return env;
  };

  it("refuses to start with a provider and no admission rule", () => {
    assert.throws(() => loadConfig(withoutRules()), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /nothing says who may edit this site/i);
      assert.match(error.message, /MICA_ADMIT_GROUPS/);
      return true;
    });
  });

  for (const rule of [
    { MICA_ADMIT_GROUPS: "mica-editors" },
    { MICA_ADMIT_DOMAINS: "example.com" },
    { MICA_ADMIT_EMAILS: "alice@gmail.com" },
    { MICA_ADMIT_SUBJECTS: "https://auth.example.com|a1b2c3" },
  ]) {
    it(`accepts ${Object.keys(rule)[0]} on its own`, () => {
      assert.doesNotThrow(() => loadConfig({ ...withoutRules(), ...rule }));
    });
  }

  it("reads all four as comma-separated lists", () => {
    const config = loadConfig({
      ...base,
      MICA_ADMIT_GROUPS: "editors, writers",
      MICA_ADMIT_DOMAINS: "Example.com, @acme.test",
      MICA_ADMIT_EMAILS: "Alice@Gmail.com, bob@example.com",
      MICA_ADMIT_SUBJECTS: "https://a.test|one, https://b.test|two",
    });

    assert.deepEqual(config.admitGroups, ["editors", "writers"]);
    // Lowercased, and an `@` the operator typed out of habit is not part of it.
    assert.deepEqual(config.admitDomains, ["example.com", "acme.test"]);
    assert.deepEqual(config.admitEmails, ["alice@gmail.com", "bob@example.com"]);
    assert.deepEqual(config.admitSubjects, [
      { issuer: "https://a.test", subject: "one" },
      { issuer: "https://b.test", subject: "two" },
    ]);
  });

  /** A domain rule for a public provider admits the public. */
  it("refuses a domain where anybody can register an address", () => {
    assert.throws(
      () => loadConfig({ ...withoutRules(), MICA_ADMIT_DOMAINS: "example.com, Gmail.com" }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /gmail\.com, where anybody can register/);
        assert.match(error.message, /MICA_ADMIT_EMAILS/);
        return true;
      },
    );
  });

  it("refuses an email entry that is not an address", () => {
    assert.throws(
      () => loadConfig({ ...withoutRules(), MICA_ADMIT_EMAILS: "alice" }),
      /not: alice/,
    );
  });

  /**
   * A subject keyed on an email address gives access to whoever holds that
   * address today: account takeover.
   */
  it("refuses a subject that is not keyed by issuer", () => {
    assert.throws(
      () => loadConfig({ ...base, MICA_ADMIT_SUBJECTS: "you@example.com" }),
      /issuer\|subject/,
    );
  });
});

/** A configuration that cannot work must stop the start, not fail later when an editor saves. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ConfigError, runtimeEnv } from "@micacms/runtime";

import { KNOWN, loadConfig } from "../src/config.js";

/** A valid environment; tests subtract from it. */
const base: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  MICA_LOG_LEVEL: "silent",
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
  const production = { ...base, NODE_ENV: "production" };

  it("refuses plain HTTP in production", () => {
    assert.throws(
      () => loadConfig({ ...production, MICA_PUBLIC_URL: "http://cms.example.com" }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /https:\/\//);
        return true;
      },
    );
  });

  it("accepts https, and plain HTTP on loopback for a trial on one machine", () => {
    for (const url of ["https://cms.example.com", "http://localhost:6422", "http://127.0.0.1:6422"]) {
      assert.equal(loadConfig({ ...production, MICA_PUBLIC_URL: url }).MICA_PUBLIC_URL, url);
    }
  });

  it("refuses a missing public URL in production, whose default is localhost", () => {
    assert.throws(() => loadConfig({ ...production }), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /MICA_PUBLIC_URL is not set/);
      return true;
    });
  });

  it("allows plain HTTP outside production", () => {
    assert.equal(loadConfig({ ...base, MICA_PUBLIC_URL: "http://cms.example.com" }).MICA_PUBLIC_URL, "http://cms.example.com");
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
    const config = loadConfig({ ...base });
    assert.equal(config.repository.branch, "main");
    assert.equal(config.repository.root, "content");
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

  it("refuses plain HTTP, SSH, and anything but https outside development", () => {
    for (const url of ["http://gitlab.com/acme/site.git", "git@gitlab.com:acme/site.git", "file:///srv/site.git"]) {
      refuses({ ...base, MICA_REPOSITORY_URL: url }, /MICA_REPOSITORY_URL/);
    }
  });

  it("accepts plain HTTP on loopback in development, for the tests and a local trial", () => {
    const config = loadConfig({ ...base, NODE_ENV: "development", MICA_REPOSITORY_URL: "http://127.0.0.1:3000/site.git" });
    assert.equal(config.repository.remote.scheme, "http");
  });

  it("refuses a branch name Git would read as something else, and a root outside the repository", () => {
    refuses({ ...base, MICA_REPOSITORY_BRANCH: "--upload-pack=x" }, /not a branch name/);
    refuses({ ...base, MICA_REPOSITORY_ROOT: "../etc" }, /inside the repository/);
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

  it("requires the session secret in production", () => {
    const production: NodeJS.ProcessEnv = {
      ...base,
      NODE_ENV: "production",
      MICA_PUBLIC_URL: "https://cms.example.com",
    };
    delete production["MICA_SESSION_SECRET"];

    assert.throws(() => loadConfig(production), /MICA_SESSION_SECRET/);
  });

  it("generates an ephemeral secret outside production, and says so", () => {
    const dev = { ...base };
    delete dev["MICA_SESSION_SECRET"];

    const config = loadConfig(dev);
    assert.equal(config.sessionSecret.length >= 32, true);
    assert.deepEqual(config.devSecrets, ["MICA_SESSION_SECRET"]);
  });

  /** A remote issuer over HTTP would give the ID token to anybody on the path. */
  it("permits insecure discovery only for a local provider outside production", () => {
    const local = loadConfig({
      ...base,
      MICA_OIDC_ISSUER: "http://localhost:8080/realms/mica",
    });
    assert.equal(local.oidcAllowInsecure, true);

    const remote = loadConfig({ ...base, MICA_OIDC_ISSUER: "http://auth.example.com" });
    assert.equal(remote.oidcAllowInsecure, false);

    const production = loadConfig({
      ...base,
      NODE_ENV: "production",
      MICA_PUBLIC_URL: "https://cms.example.com",
      MICA_OIDC_ISSUER: "http://localhost:8080/realms/mica",
    });
    assert.equal(production.oidcAllowInsecure, false);
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

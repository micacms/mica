import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentSetup, startupBanner } from "../src/banner.js";

describe("how to add Mica to an agent", () => {
  it("names the /mcp address for an agent, without changing it", () => {
    const [command, json] = agentSetup({ url: "http://localhost:6422/mcp" }, false);
    assert.match(command!, /claude mcp add --transport http mica http:\/\/localhost:6422\/mcp$/);
    const config = JSON.parse(json!.replace(/^\s*\.mcp\.json\s*/, ""));
    assert.deepEqual(config, { mcpServers: { mica: { type: "http", url: "http://localhost:6422/mcp" } } });
  });

  it("repeats the options of mica mcp, quoted for the shell", () => {
    const [command, json] = agentSetup({ args: ["mica", "mcp", "./my content", "--allow-publish"] }, false);
    assert.match(command!, /claude mcp add mica -- npx mica mcp '\.\/my content' --allow-publish$/);
    const config = JSON.parse(json!.replace(/^\s*\.mcp\.json\s*/, ""));
    assert.deepEqual(config.mcpServers.mica, { command: "npx", args: ["mica", "mcp", "./my content", "--allow-publish"] });
  });

  it("is in the banner of mica start", () => {
    const banner = startupBanner(
      { version: "0.10.0", url: "http://localhost:7000", contentRoot: "/tmp/content", collections: 1, singletons: 0 },
      false,
    );
    assert.match(banner, /claude mcp add --transport http mica http:\/\/localhost:7000\/mcp/);
  });
});

describe("the banner on a detached HEAD", () => {
  const base = { version: "0.11.0", url: "http://localhost:7000", contentRoot: "/tmp/content", collections: 1, singletons: 0 };

  it("says that Publish waits, and gives the command that checks out the branch", () => {
    const banner = startupBanner({ ...base, detached: { submodule: true, command: "git -C content switch main" } }, false);
    assert.match(banner, /Publish {4}waits: the content submodule is on a detached HEAD\. Check out its branch:\n {13}git -C content switch main\n/);
  });

  it("says nothing of it on a branch", () => {
    assert.doesNotMatch(startupBanner(base, false), /detached/);
  });
});

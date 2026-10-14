#!/usr/bin/env node
/**
 * Audits what Mica ships, and fails only for that.
 *
 *   node scripts/audit.mjs
 *
 * Two audits:
 *   - The production dependencies of `packages/` and `apps/`. The two websites'
 *     Astro dependencies are not shipped: a finding there is listed, not failed.
 *   - Every dependency of `@micacms/editor-ui`. Its libraries are development
 *     dependencies because they ship bundled, so `--prod` skips them, but they
 *     run in the browser of every editor. Its build tools are left out.
 *
 * A high or critical finding in what Mica ships fails.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAILING = new Set(["high", "critical"]);
const SHIPPED = /^(packages|apps)\//;
const EDITOR = "packages/editor-ui";
/** Dependencies of the editor that build it and are not in the bundle. */
const BUILD_ONLY = new Set(["vite", "@vitejs/plugin-vue", "@tailwindcss/vite", "tailwindcss", "tsx", "typescript", "vue-tsc", "@types/node"]);

function audit(...flags) {
  const run = spawnSync(
    process.execPath,
    [path.join(ROOT, "common/scripts/install-run-rush-pnpm.js"), "audit", "--json", ...flags],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  // The Rush wrapper prints a banner before pnpm's JSON.
  const start = run.stdout.indexOf("{");
  if (start === -1) {
    console.error(run.stdout + run.stderr);
    console.error("The audit printed no report.");
    process.exit(2);
  }
  return Object.values(JSON.parse(run.stdout.slice(start)).advisories ?? {});
}

/** `..__..__packages__runtime>image-size>…` → `packages/runtime` and `image-size` */
const parse = (auditPath) => {
  const [workspace = "", direct = ""] = auditPath.split(">");
  return { workspace: workspace.replace(/^(\.\.__)+/, "").replaceAll("__", "/"), direct };
};

/** Each advisory once, with the workspaces where Mica ships it. */
const advisories = new Map();
const note = (advisory, shippedIn) => {
  const entry = advisories.get(advisory.id) ?? { advisory, shipped: new Set(), seen: new Set() };
  advisories.set(advisory.id, entry);
  for (const finding of advisory.findings) {
    for (const { workspace, direct } of finding.paths.map(parse)) {
      entry.seen.add(workspace);
      if (shippedIn(workspace, direct)) entry.shipped.add(workspace);
    }
  }
};
for (const advisory of audit("--prod")) note(advisory, (workspace) => SHIPPED.test(workspace));
for (const advisory of audit()) note(advisory, (workspace, direct) => workspace === EDITOR && !BUILD_ONLY.has(direct));

let failed = 0;
for (const { advisory, shipped, seen } of advisories.values()) {
  const fails = FAILING.has(advisory.severity) && shipped.size > 0;
  if (fails) failed++;
  const where = [...(shipped.size > 0 ? shipped : seen)].join(", ");
  const line = `${advisory.severity} ${advisory.module_name} ${advisory.vulnerable_versions} (${where}): ${advisory.title} ${advisory.url}`;
  console.log(`${fails ? "FAIL" : "info"}  ${line}`);
}

if (failed > 0) {
  console.error(`\n${failed} high or critical finding(s) in shipped packages.`);
  process.exit(1);
}
console.log("\nNo high or critical finding in shipped packages.");

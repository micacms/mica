#!/usr/bin/env node
/**
 * Audits the production dependencies, and fails only for what Mica ships.
 *
 *   node scripts/audit.mjs
 *
 * `pnpm audit` covers the whole lockfile, the two websites included. Their
 * Astro dependencies are not shipped, so a finding there is reported and does
 * not fail. A high or critical finding in `packages/` or `apps/` fails.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAILING = new Set(["high", "critical"]);
const SHIPPED = /^(packages|apps)\//;

const run = spawnSync(
  process.execPath,
  [path.join(ROOT, "common/scripts/install-run-rush-pnpm.js"), "audit", "--prod", "--json"],
  { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

// The Rush wrapper prints a banner before pnpm's JSON.
const start = run.stdout.indexOf("{");
if (start === -1) {
  console.error(run.stdout + run.stderr);
  console.error("The audit printed no report.");
  process.exit(2);
}
const report = JSON.parse(run.stdout.slice(start));

/** `..__..__packages__runtime>image-size` → `packages/runtime` */
const workspaceOf = (auditPath) => auditPath.split(">")[0].replace(/^(\.\.__)+/, "").replaceAll("__", "/");

let failed = 0;
for (const advisory of Object.values(report.advisories ?? {})) {
  const workspaces = new Set(advisory.findings.flatMap((f) => f.paths.map(workspaceOf)));
  const shipped = [...workspaces].filter((w) => SHIPPED.test(w));
  const fails = FAILING.has(advisory.severity) && shipped.length > 0;
  if (fails) failed++;

  const where = (shipped.length > 0 ? shipped : [...workspaces]).join(", ");
  const line = `${advisory.severity} ${advisory.module_name} ${advisory.vulnerable_versions} (${where}): ${advisory.title} ${advisory.url}`;
  console.log(`${fails ? "FAIL" : "info"}  ${line}`);
}

if (failed > 0) {
  console.error(`\n${failed} high or critical finding(s) in shipped packages.`);
  process.exit(1);
}
console.log("\nNo high or critical finding in shipped packages.");

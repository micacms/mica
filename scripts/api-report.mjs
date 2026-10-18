#!/usr/bin/env node
/**
 * Writes or checks the API report of each public entry point of a package (#56).
 *
 *   node ../../scripts/api-report.mjs     (from a package folder, after tsc)
 *
 * It runs API Extractor once for each `api-extractor*.json` in the package.
 * On a developer's machine it writes the reports to `api/`: commit them with
 * the change. In CI (`CI` set), it fails when the built API is not the one in
 * the committed report, as the Astro loader does for `.mica/schema.json`.
 */

import { mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// API Extractor is a development dependency of the package, not of the repository root.
const require = createRequire(path.join(process.cwd(), "package.json"));
const { Extractor, ExtractorConfig } = require("@microsoft/api-extractor");

const local = !process.env.CI;
const configs = readdirSync(process.cwd()).filter((name) => /^api-extractor.*\.json$/.test(name)).sort();
let failed = false;

for (const file of configs) {
  const config = ExtractorConfig.loadFileAndPrepare(path.resolve(file));
  if (local) mkdirSync(path.dirname(config.reportFilePath), { recursive: true });
  const result = Extractor.invoke(config, { localBuild: local });
  if (!result.succeeded) {
    failed = true;
    console.error(
      result.apiReportChanged
        ? `${config.reportFilePath} is not the built API. Run \`rush build\` and commit the report.`
        : `API Extractor found ${result.errorCount} errors and ${result.warningCount} warnings for ${file}.`,
    );
  }
}

if (failed) process.exit(1);

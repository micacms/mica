/**
 * Compiles a project's content model into the artifact the CMS consumes.
 *
 *   pnpm build:schema                       # mica.config.ts -> mica.config.json
 *   pnpm build:schema --in x.ts --out y.json
 *
 * The output is JSON rather than JavaScript, for two reasons. A JSON file has
 * no imports, so it can be mounted anywhere in the container without landing
 * next to a `node_modules` that can resolve `@micacms/model`. And it is exactly
 * the payload a `mica push` would send to a hosted CMS, so the self-hosted and
 * hosted paths produce the same bytes.
 *
 * Version coupling is resolved in the right direction by this step: the
 * builders run here, under the *project's* copy of `@micacms/model`, and emit
 * plain data. The server then re-validates that data against its own copy, and
 * reports any field kind it does not know (see `../schema.ts`).
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { loadSchema, SchemaError } from "../schema.js";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  // Defaults are relative to the repository root from `apps/cms`, matching the
  // development fallback in `config.ts`.
  const input = path.resolve(argValue("--in") ?? "../../mica.config.ts");
  const output = path.resolve(argValue("--out") ?? "../../mica.config.json");

  // Loading goes through the same path the server uses, so a model that builds
  // here is one the server will accept.
  const site = await loadSchema(input);

  await writeFile(output, `${JSON.stringify(site, null, 2)}\n`, "utf8");

  const collections = Object.keys(site.collections);
  const globals = Object.keys(site.singletons);

  process.stdout.write(
    `Wrote ${path.relative(process.cwd(), output)}\n` +
      `  collections: ${collections.join(", ") || "(none)"}\n` +
      `  globals:     ${globals.join(", ") || "(none)"}\n`,
  );
}

main().catch((error: unknown) => {
  if (error instanceof SchemaError) {
    process.stderr.write(`\n${error.message}\n\n`);
    process.exit(1);
  }
  process.stderr.write(
    `\nCould not build the schema: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});

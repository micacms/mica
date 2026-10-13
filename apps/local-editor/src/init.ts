/**
 * `mica init` — adds Mica to an Astro project: a starter model and the content
 * collections. It never overwrites a file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MODEL = `import {
  collection,
  date,
  defineSite,
  media,
  richText,
  singleton,
  slug,
  text,
} from "@micacms/core";

export const site = defineSite({
  root: "./content",

  collections: {
    news: collection({
      label: "News",
      labelSingular: "Article",
      fields: {
        title: text({ label: "Title", required: true, maxLength: 120, listed: true }),
        slug: slug({ from: "title" }),
        publishedOn: date({ label: "Published on", listed: true }),
        cover: media({ accept: "image", alt: "required" }),
        body: richText(),
      },
    }),
  },

  singletons: {
    settings: singleton({
      label: "Website",
      fields: {
        siteName: text({ label: "Site name", required: true }),
        tagline: text({ label: "Tagline" }),
      },
    }),
  },
});
`;

const COLLECTIONS = `import { micaCollections } from "@micacms/astro";

import { site } from "./mica";

export const collections = micaCollections(site);
`;

const MERGE = `  import { micaCollections } from "@micacms/astro";
  import { site } from "./mica";

  export const collections = { ...micaCollections(site), /* your collections */ };`;

export interface InitResult {
  /** Files and directories made, relative to the project. */
  created: string[];
  /** Files that already existed and were left alone. */
  kept: string[];
  /** What the person or agent does next. */
  next: string[];
}

export class InitError extends Error {
  override name = "InitError";
}

/** Adds Mica to the Astro project in `project`. */
export function initProject(project: string): InitResult {
  const manifest = path.join(project, "package.json");
  if (!existsSync(manifest)) {
    throw new InitError(`There is no package.json in ${project}. Create an Astro project first: npm create astro@latest`);
  }
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(readFileSync(manifest, "utf8")) as typeof pkg;
  } catch (cause) {
    throw new InitError(`${manifest} is not valid JSON: ${(cause as Error).message}`);
  }
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!dependencies["astro"]) {
    throw new InitError(`${manifest} has no "astro" dependency. Run mica init in an Astro project.`);
  }

  const result: InitResult = { created: [], kept: [], next: [] };

  const model = existingFile(project, ["src/mica.ts", "src/mica.mts", "src/mica.js", "src/mica.mjs"]);
  if (model) result.kept.push(model);
  else write(project, "src/mica.ts", MODEL, result);

  const config = existingFile(project, [
    "src/content.config.ts",
    "src/content.config.mts",
    "src/content.config.js",
    "src/content.config.mjs",
    "src/content/config.ts",
    "src/content/config.mts",
    "src/content/config.js",
    "src/content/config.mjs",
  ]);
  if (config) {
    result.kept.push(config);
    if (!readFileSync(path.join(project, config), "utf8").includes("micaCollections")) {
      result.next.push(`Add the Mica collections to ${config}:\n\n${MERGE}`);
    }
  } else {
    write(project, "src/content.config.ts", COLLECTIONS, result);
  }

  const missing = ["@micacms/astro", "@micacms/core"].filter((name) => !dependencies[name]);
  if (missing.length > 0) result.next.push(`Install the packages: npm install ${missing.join(" ")}`);
  if (!dependencies["@micacms/editor"]) result.next.push("Install the editor: npm install --save-dev @micacms/editor");
  const scripts = scriptsToSet(pkg.scripts ?? {}, Boolean(dependencies["@astrojs/check"]));
  if (scripts.length > 0) result.next.push(`Set in "scripts" in package.json:\n\n${scripts.map((line) => `  ${line}`).join(",\n")}`);
  result.next.push(
    model
      ? "Add the website's collections and singletons to the model in src/mica.ts."
      : "Replace the starter model in src/mica.ts (news, settings) with the website's model.",
    "Write the model to content/.mica/schema.json: npx astro sync",
    "Check the content: npx mica check",
    "When the content is in place, open the editor in a browser: npx mica start",
  );
  return result;
}

/** `npm run mica` opens the editor (`mica start`); `npm run check` checks the content, and the types when `@astrojs/check` is there. */
function scriptsToSet(scripts: Record<string, string>, astroCheck: boolean): string[] {
  const missing: string[] = [];
  if (!scripts["mica"]) missing.push(`"mica": "mica start"`);
  // Without @astrojs/check, `astro check` asks to install it, and a script cannot answer.
  const check = scripts["check"];
  if (!check) missing.push(`"check": "${astroCheck ? "mica check && astro check" : "mica check"}"`);
  else if (!check.includes("mica check")) missing.push(`"check": ${JSON.stringify(`mica check && ${check}`)}`);
  return missing;
}

function existingFile(project: string, candidates: string[]): string | undefined {
  return candidates.find((candidate) => existsSync(path.join(project, candidate)));
}

function write(project: string, file: string, contents: string, result: InitResult): void {
  mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
  writeFileSync(path.join(project, file), contents, { flag: "wx" });
  result.created.push(file);
}

/** The result as a person or an agent reads it. */
export function formatInit(result: InitResult): string {
  const lines: string[] = [];
  for (const file of result.created) lines.push(`  created  ${file}`);
  for (const file of result.kept) lines.push(`  kept     ${file}`);
  lines.push("", "Next:", "");
  result.next.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`, ...(step.includes("\n") ? [""] : [])));
  return `${lines.join("\n")}\n`;
}

/**
 * The editor speaks of saving and publishing, not of Git. Git words may appear
 * only on the System page and inside `<DeveloperDetails>`.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const SRC = join(import.meta.dirname, "../src");
const ALLOWED_FILES = new Set(["views/SystemView.vue", "components/DeveloperDetails.vue"]);
const GIT_WORDS =
  /\b(git|commits?|committed|committing|push|pushes|pushed|pushing|branch(?:es)?|repositor(?:y|ies)|upstream|working tree|checkout|revisions?|merge|hash|clone|remote|HEAD)\b/i;

function vueFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    if (item.isDirectory()) return vueFiles(path);
    return item.name.endsWith(".vue") ? [path] : [];
  });
}

/** String literals in a piece of script: what a user can read. */
function literals(code: string): string[] {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  return [...withoutComments.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

/** The text a user reads in one component: template text, static attributes and string literals. */
function readableText(source: string): string[] {
  const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
  let template = source.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? "";
  template = template
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<DeveloperDetails[\s\S]*?<\/DeveloperDetails>/g, "");

  const texts: string[] = literals(script);
  for (const [, expression] of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) texts.push(...literals(expression ?? ""));
  for (const [, name, value] of template.matchAll(/\s([:@]?[\w-]+)="([^"]*)"/g)) {
    if (name!.startsWith(":") || name!.startsWith("@") || name!.startsWith("v-")) texts.push(...literals(value!));
    else if (["aria-label", "placeholder", "title", "label", "subtitle", "confirm-label", "back-label"].includes(name!)) {
      texts.push(value!);
    }
  }
  texts.push(
    ...template
      .replace(/\{\{[\s\S]*?\}\}/g, " ")
      .replace(/<[^>]*>/g, "\n")
      .split("\n"),
  );
  // A single lower-case word is a key or a type, like `SyncConflict["upstream"]`, not text.
  return texts.map((text) => text.trim()).filter((text) => text !== "" && !/^[a-z]+$/.test(text));
}

describe("the editor's words", () => {
  it("uses no Git words outside the System page and the developer details", () => {
    const found: string[] = [];
    for (const file of vueFiles(SRC)) {
      const name = relative(SRC, file).split("\\").join("/");
      if (ALLOWED_FILES.has(name)) continue;
      for (const text of readableText(readFileSync(file, "utf8"))) {
        if (GIT_WORDS.test(text)) found.push(`${name}: ${text}`);
      }
    }
    assert.deepEqual(found, []);
  });
});

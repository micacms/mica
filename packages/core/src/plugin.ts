/** The checks of a `Plugin` item: in `defineSite`, and for each reader of a manifest. */

import type { Plugin } from "./types.js";

const NAME = /^[a-z][a-z0-9-]*$/;
// The rules of npm for a new package name: lower case, and an optional scope.
const PACKAGE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const ITEM_KEYS = new Set(["name", "package", "options"]);

/** Why `value` is not a plugin item, or `null`. */
export function pluginProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return "must be an object: { name, package, options }";
  const unknown = Object.keys(value).filter((key) => !ITEM_KEYS.has(key));
  if (unknown.length > 0) return `has keys that a plugin item does not have: ${unknown.join(", ")}`;
  if (typeof value["name"] !== "string" || !NAME.test(value["name"])) {
    return "needs a `name` of lower-case letters, digits and -, that starts with a letter";
  }
  if (typeof value["package"] !== "string" || value["package"].length > 214 || !PACKAGE.test(value["package"])) {
    return "needs a `package` that is an npm package name";
  }
  if (value["options"] !== undefined && !(isPlainObject(value["options"]) && isJsonData(value["options"]))) {
    return "has `options` that are not a JSON object";
  }
  return null;
}

/** Why the list is not valid, or `null`: each item is valid, and no two have the same name. */
export function pluginsProblem(plugins: unknown): string | null {
  if (!Array.isArray(plugins)) return "`plugins` must be a list";
  const names = new Set<string>();
  for (const [index, item] of plugins.entries()) {
    const problem = pluginProblem(item);
    if (problem) return `the plugin at position ${index + 1} ${problem}`;
    const { name } = item as Plugin;
    if (names.has(name)) return `two plugins have the name "${name}"`;
    names.add(name);
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// The options go into the manifest: a value that JSON changes or drops would differ in the editor.
function isJsonData(value: unknown, open = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value) && !isPlainObject(value)) return false;
  // A cycle is not JSON.
  if (open.has(value)) return false;
  open.add(value);
  const valid = Object.values(value).every((item) => isJsonData(item, open));
  open.delete(value);
  return valid;
}

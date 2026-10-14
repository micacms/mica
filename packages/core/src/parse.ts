/**
 * Repository files → entry payload.
 *
 * The inverse of `serializeEntry`. Deliberately tolerant: content in Git can be
 * edited by hand, by a script, or by an older version of Mica, so parsing
 * repairs what it can — missing keys become defaults, unknown keys are dropped —
 * and refuses only what it cannot interpret at all.
 *
 * Validation is a separate step. `parseEntry` answers "what does this entry
 * say"; `validateFields` answers "may it be published".
 */

import { FormatError, documentPath } from "./layout.js";
import { withDefaults } from "./defaults.js";
import { ROW_KEY } from "./row-key.js";
import type { AnyField, FieldMap } from "./types.js";

export interface EntryFiles {
  /** Contents of `index.json`. */
  data: string;
  /** Rich-text sidecars, keyed by file name relative to the entry. */
  documents?: Record<string, string>;
}

export function parseEntry(fields: FieldMap, files: EntryFiles): Record<string, unknown> {
  const data = withDefaults(fields, parseJson(files.data));

  for (const [name, contents] of Object.entries(files.documents ?? {})) {
    // A sidecar whose path no longer names a rich-text field is left alone
    // rather than treated as an error: it is most likely a field that was
    // removed from the model, and refusing to open the entry would be a poor
    // way to tell the editor about it.
    place(fields, data, documentPath(name), contents.replace(/\n$/, ""));
  }

  return data;
}

function parseJson(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new FormatError(
      `Content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FormatError("Content must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

/**
 * Writes one rich-text document back into the payload at its dotted path.
 *
 * Walks the model in step with the data so that a path is only followed where
 * the model agrees it leads somewhere — `sections.k3f9a2.body` has to pass
 * through a repeater called `sections`, a row with that key, and land on a
 * rich-text field called `body`.
 */
function place(
  fields: FieldMap,
  data: Record<string, unknown>,
  path: readonly string[],
  contents: string,
): void {
  const [head = "", ...rest] = path;
  const field: AnyField | undefined = fields[head];
  if (!field) return;

  if (rest.length === 0) {
    if (field.kind === "richText") data[head] = contents;
    return;
  }

  if (field.kind === "object") {
    const child = data[head];
    if (child === null || typeof child !== "object" || Array.isArray(child)) return;
    place(field.fields, child as Record<string, unknown>, rest, contents);
    return;
  }

  if (field.kind === "repeater") {
    const [segment, ...tail] = rest;
    const rows = data[head];
    if (!Array.isArray(rows)) return;

    const row = rows.find((item) => item !== null && typeof item === "object" && (item as Record<string, unknown>)[ROW_KEY] === segment);
    if (row === null || typeof row !== "object" || Array.isArray(row)) return;
    place(field.fields, row as Record<string, unknown>, tail, contents);
  }
}

/**
 * Turns a raw before/after pair into rows an editor reads.
 *
 * The server's comparison is two documents of field data; everything friendly
 * about it happens here, where the model is at hand: fields get their labels,
 * nesting becomes a breadcrumb, unchanged values disappear, and each value is
 * written the way its field type would show it — never as JSON with quotes.
 */

import type { AnyField, FieldMap } from "@micacms/core";

import { humanise } from "@/composables/useField";

/** One changed value, named and rendered for both sides. */
export interface CompareRow {
  /** Unique among the rows — the dotted path of the leaf. */
  path: string;
  /** Breadcrumb of labels, e.g. `["Extra sections", "2", "Heading"]`. */
  label: string[];
  /** The field's kind, as a rendering hint (`richText` wants more room). */
  kind: string;
  /** Display strings; null on the side where the document does not exist. */
  before: string | null;
  after: string | null;
}

/**
 * The changed fields between two documents, in model order.
 *
 * A side that is null means the document itself is absent there (a creation
 * or a deletion); every present value on the other side becomes a row, so the
 * comparison doubles as a summary of the new or removed document.
 */
export function compareRows(
  fields: FieldMap,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): CompareRow[] {
  return walk(fields, before, after, [], []);
}

function walk(
  fields: FieldMap,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  path: string[],
  label: string[],
): CompareRow[] {
  const rows: CompareRow[] = [];

  for (const [name, field] of Object.entries(fields)) {
    if (field.hidden) continue;

    const a = before === null ? undefined : before[name];
    const b = after === null ? undefined : after[name];
    const at = [...path, name];
    const named = [...label, field.label ?? humanise(name)];

    // Null means "this side's document does not exist" all the way down. A
    // *value* that is merely missing inside an existing document becomes an
    // empty record instead, so its leaves read as Empty rather than vanish.
    if (field.kind === "object") {
      rows.push(
        ...walk(
          field.fields,
          before === null ? null : (asRecord(a) ?? {}),
          after === null ? null : (asRecord(b) ?? {}),
          at,
          named,
        ),
      );
      continue;
    }

    if (field.kind === "repeater") {
      rows.push(
        ...repeaterRows(field.fields, field.itemLabel, asList(a), asList(b), at, named, {
          before: before !== null,
          after: after !== null,
        }),
      );
      continue;
    }

    if (canonical(a) === canonical(b)) continue;

    rows.push({
      path: at.join("."),
      label: named,
      kind: field.kind,
      before: before === null ? null : displayValue(field, a),
      after: after === null ? null : displayValue(field, b),
    });
  }

  return rows;
}

/**
 * Repeater items compared by position. Position is what the editor sees and
 * what the file stores; chasing moved items across indexes would guess.
 */
function repeaterRows(
  fields: FieldMap,
  itemLabel: string | undefined,
  before: Array<Record<string, unknown>> | null,
  after: Array<Record<string, unknown>> | null,
  path: string[],
  label: string[],
  present: { before: boolean; after: boolean },
): CompareRow[] {
  const rows: CompareRow[] = [];
  const count = Math.max(before?.length ?? 0, after?.length ?? 0);

  for (let index = 0; index < count; index++) {
    const a = before?.[index] ?? (present.before ? {} : null);
    const b = after?.[index] ?? (present.after ? {} : null);

    // Name the item by its summary field where one is set, else its number.
    const caption = (item: Record<string, unknown> | null) => {
      const value = itemLabel ? item?.[itemLabel] : undefined;
      return typeof value === "string" && value !== "" ? value : `${index + 1}`;
    };

    rows.push(...walk(fields, a, b, [...path, String(index)], [...label, caption(b ?? a)]));
  }

  return rows;
}

/**
 * A field value as the editor would say it — `displayValue` never shows JSON.
 * Null on both ends of a row is prevented by the change filter, so "Empty"
 * only ever appears opposite a real value.
 */
export function displayValue(field: AnyField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Empty";

  if (field.kind === "boolean") return value === true ? "Yes" : "No";

  if (field.kind === "select") {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((entry) => field.options.find((option) => option.value === entry)?.label ?? String(entry))
      .join(", ");
  }

  if (field.kind === "media") {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) return "Empty";
    return values
      .map((entry) => {
        // `media({ alt })` stores `{ path, alt }`.
        const { path, alt } = typeof entry === "string" ? { path: entry, alt: null } : (asRecord(entry) ?? {});
        const name = String(path).split("/").at(-1) ?? String(path);
        return typeof alt === "string" && alt ? `${name} ("${alt}")` : name;
      })
      .join(", ");
  }

  if (field.kind === "coordinates") {
    const point = asRecord(value);
    if (point && typeof point["lat"] === "number" && typeof point["lng"] === "number") {
      return `${point["lat"].toFixed(5)}, ${point["lng"].toFixed(5)}`;
    }
  }

  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return canonical(value);

  return String(value);
}

/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asList(value: unknown): Array<Record<string, unknown>> | null {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : null;
}

/** Canonical JSON — keys sorted, so a rebuilt object compares equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, entry: unknown) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = record[key];
    return sorted;
  });
}

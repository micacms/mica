/**
 * Summarises a content model.
 *
 * The admin already receives the whole model and could count fields itself, but
 * the interesting numbers are the recursive ones — objects and repeaters nest —
 * and the relation graph, which is only visible after walking every branch.
 * Doing it here keeps that walk in one place, next to the schema checks that
 * use the same shapes.
 *
 * Pure: it reads a `Site` and nothing else, so it is the same answer for the
 * same model whatever the state of the database.
 */

import {
  listedFields,
  resolveSlugField,
  resolveTitleField,
  type AnyField,
  type FieldKind,
  type FieldMap,
  type Site,
} from "@micacms/model";

export interface KindUsage {
  kind: FieldKind;
  count: number;
}

export interface RelationEdge {
  /** Collection or singleton the field is declared in. */
  from: string;
  fromType: "collection" | "global";
  /** Dotted path to the field, with `[]` marking a repeater. */
  path: string;
  /** Collection the relation points at. */
  to: string;
  multiple: boolean;
}

export interface FieldCounts {
  /** Fields declared directly on the collection or singleton. */
  top: number;
  /** Every field, including those nested in objects and repeaters. */
  total: number;
  required: number;
}

export interface CollectionStats {
  name: string;
  label: string;
  fields: FieldCounts;
  titleField: string | null;
  slugField: string | null;
  listed: number;
  sortable: boolean;
  /** Deepest level of nesting; 1 means no objects or repeaters. */
  depth: number;
}

export interface GlobalStats {
  name: string;
  label: string;
  fields: FieldCounts;
  depth: number;
}

export interface SchemaStats {
  collections: CollectionStats[];
  globals: GlobalStats[];
  totals: FieldCounts & { collections: number; globals: number };
  /** Field kinds in use, most used first. */
  kinds: KindUsage[];
  relations: RelationEdge[];
}

/** The two kinds that carry a nested `fields` map. */
function children(field: AnyField): FieldMap | null {
  return field.kind === "object" || field.kind === "repeater" ? field.fields : null;
}

/**
 * Depth-first walk over a field map, visiting nested fields too.
 *
 * `path` is what an editor would say out loud — `blocks[].heading` rather than
 * `blocks.fields.heading` — so it can be printed as-is.
 */
function walk(
  fields: FieldMap,
  visit: (key: string, field: AnyField, path: string, depth: number) => void,
  prefix = "",
  depth = 1,
): void {
  for (const [key, field] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    visit(key, field, path, depth);

    const nested = children(field);
    if (nested) {
      walk(nested, visit, field.kind === "repeater" ? `${path}[]` : path, depth + 1);
    }
  }
}

function countFields(fields: FieldMap): { counts: FieldCounts; depth: number } {
  const counts: FieldCounts = { top: Object.keys(fields).length, total: 0, required: 0 };
  let deepest = 1;

  walk(fields, (_key, field, _path, depth) => {
    counts.total++;
    if (field.required) counts.required++;
    if (depth > deepest) deepest = depth;
  });

  return { counts, depth: deepest };
}

export function schemaStats(site: Site): SchemaStats {
  const kinds = new Map<FieldKind, number>();
  const relations: RelationEdge[] = [];

  const totals: FieldCounts & { collections: number; globals: number } = {
    collections: 0,
    globals: 0,
    top: 0,
    total: 0,
    required: 0,
  };

  const tally = (fields: FieldMap, from: string, fromType: RelationEdge["fromType"]): void => {
    walk(fields, (_key, field, path) => {
      kinds.set(field.kind, (kinds.get(field.kind) ?? 0) + 1);

      if (field.kind === "relation") {
        relations.push({ from, fromType, path, to: field.collection, multiple: field.multiple ?? false });
      }
    });
  };

  const collections = Object.values(site.collections).map((def): CollectionStats => {
    const { counts, depth } = countFields(def.fields);
    tally(def.fields, def.name, "collection");

    totals.collections++;
    totals.top += counts.top;
    totals.total += counts.total;
    totals.required += counts.required;

    return {
      name: def.name,
      label: def.label,
      fields: counts,
      // The same resolution the editor sees, not the raw declaration: both keys
      // are optional in the model and fall back to a convention.
      titleField: resolveTitleField(def) ?? null,
      slugField: resolveSlugField(def) ?? null,
      listed: listedFields(def).length,
      sortable: def.sortable ?? false,
      depth,
    };
  });

  const globals = Object.values(site.singletons).map((def): GlobalStats => {
    const { counts, depth } = countFields(def.fields);
    tally(def.fields, def.name, "global");

    totals.globals++;
    totals.top += counts.top;
    totals.total += counts.total;
    totals.required += counts.required;

    return { name: def.name, label: def.label, fields: counts, depth };
  });

  return {
    collections,
    globals,
    totals,
    kinds: [...kinds]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    relations,
  };
}

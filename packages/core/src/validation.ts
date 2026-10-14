/**
 * Zod derivation.
 *
 * Zod is an implementation detail: the DSL is the public API because a field
 * descriptor carries editorial semantics (labels, groups, widths, presets) that
 * a validator cannot express. This module projects descriptors onto Zod for the
 * stored shape: media and relations are paths and slugs.
 */

import { z } from "zod";

import type { AnyField, FieldMap } from "./types.js";
import { textPattern } from "./pattern.js";
import { isValidSlug } from "./slugify.js";
import { needsRowKey, ROW_KEY } from "./row-key.js";

export interface SchemaOptions {
  /**
   * When false, `required` is not enforced and every field becomes nullable.
   *
   * Drafts use this: an editor must be able to save a half-finished entry and
   * come back tomorrow. Type and range rules still apply — only the presence
   * check is relaxed, and publishing re-validates strictly.
   */
  enforceRequired?: boolean;
  /**
   * When false, the `_key` of a repeater row is dropped. The keys name the rows'
   * rich-text files; a website's templates do not need them. Default: kept.
   */
  rowKeys?: boolean;
  /**
   * Resolves an image path the way a site framework does, such as Astro's
   * `image()`. `media({ accept: "image" })` then gives the resolved image, and
   * with `alt`, `{ src, alt }`, ready for an image component.
   */
  image?: () => z.ZodType;
}

export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ */

/** Kinds whose empty state is a value, not null. */
function neverNull(field: AnyField): boolean {
  if (field.kind === "boolean" || field.kind === "repeater" || field.kind === "tags") return true;
  return "multiple" in field && field.multiple === true;
}

/** Kinds where an empty string from a form input means "not filled in". */
function blankIsEmpty(field: AnyField): boolean {
  switch (field.kind) {
    case "text":
    case "textarea":
    case "richText":
    case "email":
    case "url":
    case "slug":
    case "color":
    case "date":
    case "select":
      return true;
    default:
      return false;
  }
}

function label(field: AnyField, key: string): string {
  return field.label ?? key;
}

/** A length limit in words an editor reads, with the current length: "Title can have at most 120 characters (now 134)." */
function lengthLimit(name: string, limit: "least" | "most", count: number) {
  const verb = limit === "least" ? "needs at least" : "can have at most";
  return (issue: { input?: unknown }): string => {
    const now = typeof issue.input === "string" ? ` (now ${issue.input.length})` : "";
    return `${name} ${verb} ${count} character${count === 1 ? "" : "s"}${now}.`;
  };
}

/** A list limit: "Gallery allows at most 5 items." */
function countLimit(name: string, limit: "least" | "most", count: number, noun: string): string {
  return `${name} ${limit === "least" ? "needs at least" : "allows at most"} ${count} ${noun}${count === 1 ? "" : "s"}.`;
}

/** A path. `{ path, alt }`, saved while the field had the `alt` option, reads as its path. */
function plainMedia(path: z.ZodType): z.ZodType {
  return z.preprocess(
    (value) => (value !== null && typeof value === "object" && "path" in value ? (value as { path: unknown }).path : value),
    path,
  );
}

/** `{ path, alt }`. A plain path, saved before the field asked for alt text, reads as one without alt text. */
function mediaWithAlt(
  alt: "required" | "optional",
  name: string,
  options: SchemaOptions,
  path: z.ZodType,
  resolved: boolean,
): z.ZodType {
  const text = z.preprocess(
    (value) => (value === undefined || (typeof value === "string" && value.trim() === "") ? null : value),
    z.string().trim().nullable(),
  );
  const shape = z.object({ path, alt: text }).strip();
  const lifted = z.preprocess((value) => (typeof value === "string" ? { path: value, alt: null } : value), shape);
  const one =
    alt === "optional" || options.enforceRequired === false
      ? lifted
      : lifted.refine((value) => value.alt !== null, { message: `${name} needs alt text.`, path: ["alt"] });
  // A resolved image goes to an image component: `{ src, alt }`, and "" for no alt text.
  return resolved ? one.transform((value) => ({ src: value.path, alt: value.alt ?? "" })) : one;
}

/** The inner schema for a field, before nullability and defaults are applied. */
function innerSchema(
  field: AnyField,
  key: string,
  options: SchemaOptions,
): z.ZodType {
  const name = label(field, key);

  switch (field.kind) {
    case "text": {
      let schema = z.string({ error: `${name} must be text.` }).trim();
      if (field.minLength !== undefined) schema = schema.min(field.minLength, { error: lengthLimit(name, "least", field.minLength) });
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength, { error: lengthLimit(name, "most", field.maxLength) });
      if (field.pattern) {
        schema = schema.regex(textPattern(field.pattern), field.patternMessage ?? `${name} does not have the expected form.`);
      }
      return schema;
    }

    case "textarea": {
      let schema = z.string({ error: `${name} must be text.` });
      if (field.minLength !== undefined) schema = schema.min(field.minLength, { error: lengthLimit(name, "least", field.minLength) });
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength, { error: lengthLimit(name, "most", field.maxLength) });
      return schema;
    }

    case "richText": {
      let schema = z.string({ error: `${name} must be text.` });
      // maxLength counts the Markdoc source; generous limits are the point here.
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength, { error: lengthLimit(name, "most", field.maxLength) });
      return schema;
    }

    case "number": {
      let schema = z.number({ error: `${name} must be a number.` }).finite({ error: `${name} must be a number.` });
      if (field.integer) schema = schema.int({ error: `${name} must be a whole number.` });
      if (field.min !== undefined) schema = schema.min(field.min, { error: `${name} must be at least ${field.min}.` });
      if (field.max !== undefined) schema = schema.max(field.max, { error: `${name} must be at most ${field.max}.` });
      return schema;
    }

    case "boolean":
      return z.boolean({ error: `${name} must be yes or no.` });

    case "date": {
      const schema = field.includeTime
        ? z.iso.datetime({ offset: true, error: `${name} must be an ISO 8601 timestamp.` })
        : z.string().regex(CALENDAR_DATE, `${name} must be a date (YYYY-MM-DD).`);
      return schema.superRefine((value, ctx) => {
        if (Number.isNaN(Date.parse(value))) {
          ctx.addIssue({ code: "custom", message: `${name} is not a valid date.` });
          return;
        }
        if (field.min && value < field.min) {
          ctx.addIssue({ code: "custom", message: `${name} must be on or after ${field.min}.` });
        }
        if (field.max && value > field.max) {
          ctx.addIssue({ code: "custom", message: `${name} must be on or before ${field.max}.` });
        }
      });
    }

    case "email":
      return z.string().trim().toLowerCase().email(`${name} must be a valid email address.`);

    case "url":
      return z
        .string()
        .trim()
        .url(`${name} must be a valid URL.`)
        .refine(
          (value) => /^https?:\/\//i.test(value),
          `${name} must start with http:// or https://.`,
        );

    case "slug":
      return z
        .string()
        .trim()
        .toLowerCase()
        .max(field.maxLength ?? 96, { error: lengthLimit(name, "most", field.maxLength ?? 96) })
        .refine(isValidSlug, `${name} may only contain lowercase letters, numbers and hyphens.`);

    case "select": {
      const values = field.options.map((option) => option.value);
      const one = z.string().refine((value) => values.includes(value), {
        message: `${name} must be one of: ${values.join(", ")}.`,
      });
      return field.multiple ? z.array(one, { error: `${name} must be a list.` }) : one;
    }

    case "color":
      return z.string().trim().regex(HEX_COLOR, `${name} must be a hex colour such as #1a2b3c.`);

    case "coordinates": {
      const axis = (word: string, limit: number) => {
        const range = `${name}: the ${word} must be between -${limit} and ${limit}.`;
        return z.number({ error: `${name}: the ${word} must be a number.` }).min(-limit, { error: range }).max(limit, { error: range });
      };
      return z.object({ lat: axis("latitude", 90), lng: axis("longitude", 180) }, { error: `${name} needs a latitude and a longitude.` });
    }

    case "media": {
      const image = field.accept === "image" ? options.image?.() : undefined;
      const path = image ?? z.string({ error: `${name} must be a file path.` }).min(1, { error: `${name} must be a file path.` });
      const one = field.alt ? mediaWithAlt(field.alt, name, options, path, image !== undefined) : plainMedia(path);
      if (!field.multiple) return one;
      let list = z.array(one, { error: `${name} must be a list of files.` });
      if (field.max !== undefined) list = list.max(field.max, { error: countLimit(name, "most", field.max, "file") });
      return list;
    }

    case "relation": {
      const one = z.string({ error: `${name} must name an entry.` }).min(1, { error: `${name} must name an entry.` });
      return field.multiple ? z.array(one, { error: `${name} must be a list of entries.` }) : one;
    }

    case "object":
      return fieldsSchema(field.fields, options);

    case "repeater": {
      let row = fieldsSchema(field.fields, options);
      // A key that is not text is dropped; the next save writes a new one.
      if (options.rowKeys !== false && needsRowKey(field.fields)) row = row.extend({ [ROW_KEY]: z.string().optional().catch(undefined) });
      let list = z.array(row, { error: `${name} must be a list.` });
      if (field.min !== undefined) list = list.min(field.min, { error: countLimit(name, "least", field.min, "item") });
      if (field.max !== undefined) list = list.max(field.max, { error: countLimit(name, "most", field.max, "item") });
      return list;
    }

    case "tags": {
      let one = z.string({ error: `${name}: a tag must be text.` }).trim().min(1, { error: `${name}: a tag cannot be empty.` });
      if (field.maxLength !== undefined) one = one.max(field.maxLength, { error: lengthLimit(`${name}: a tag`, "most", field.maxLength) });
      let list = z.array(one, { error: `${name} must be a list of tags.` });
      if (field.max !== undefined) list = list.max(field.max, { error: countLimit(name, "most", field.max, "tag") });
      return list.superRefine((values, ctx) => {
        const seen = new Set<string>();
        for (const value of values) {
          const key = value.toLowerCase();
          if (seen.has(key)) ctx.addIssue({ code: "custom", message: `${name} has the tag "${value}" twice.` });
          seen.add(key);
        }
      });
    }

    // A kind from a newer @micacms/astro: its value is kept as it is. Mica makes the collection read-only.
    default:
      return z.unknown();
  }
}

/**
 * Wraps a field schema with the coercion rules shared by every kind:
 * absent and blank values normalise to null, then nullability is applied.
 */
function fieldSchema(
  field: AnyField,
  key: string,
  options: SchemaOptions,
): z.ZodType {
  const name = label(field, key);
  const inner = innerSchema(field, key, options);

  const normalise = (value: unknown): unknown => {
    if (value === undefined) return null;
    if (value === null) return null;
    if (typeof value === "string" && blankIsEmpty(field) && value.trim() === "") return null;
    return value;
  };

  if (neverNull(field)) {
    // A missing multi-value field is an empty list; a missing boolean is false, never its default (#221).
    const fallback: unknown = field.kind === "boolean" ? false : [];
    // A required list needs one value; a boolean is never empty.
    const filled =
      field.required && options.enforceRequired !== false && field.kind !== "boolean"
        ? inner.refine((value) => !Array.isArray(value) || value.length > 0, {
            message: `${name} needs at least one ${field.kind === "tags" ? "tag" : field.kind === "repeater" ? "item" : "value"}.`,
          })
        : inner;
    return z.preprocess((value) => (normalise(value) === null ? fallback : value), filled);
  }

  if (field.required && options.enforceRequired !== false) {
    // The inner schema has to stay nullable so that a blank value reaches the
    // refinement and reports "X is required." rather than Zod's type error.
    return z.preprocess(
      normalise,
      inner.nullable().refine((value) => value !== null, { message: `${name} is required.` }),
    );
  }

  return z.preprocess(normalise, inner.nullable());
}

/**
 * A Zod object for a field map. Unknown keys are dropped, not rejected — so
 * removing a field from the model quietly retires it from existing payloads
 * instead of failing every entry written before the change.
 *
 * Returns a `ZodObject` rather than a bare `ZodType` so callers can `.extend`
 * it; the Astro integration adds entry metadata that way.
 */
export function fieldsSchema(
  fields: FieldMap,
  options: SchemaOptions = {},
): z.ZodObject<z.ZodRawShape> {
  // Built as a mutable record: Zod 4's `ZodRawShape` is readonly, and it is the
  // shape `z.object` accepts rather than the one a caller assembles.
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) {
    shape[key] = fieldSchema(field, key, options);
  }
  return z.object(shape).strip();
}

/* ------------------------------------------------------------------ *
 * Result helpers
 * ------------------------------------------------------------------ */

export interface FieldIssue {
  /** Dotted path, with numeric segments for repeater rows: `gallery.0.caption`. */
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; issues: FieldIssue[] };

export function toIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/** Validates a payload against a field map and returns a flat issue list. */
export function validateFields<T = Record<string, unknown>>(
  fields: FieldMap,
  data: unknown,
  options: SchemaOptions = {},
): ValidationResult<T> {
  const result = fieldsSchema(fields, options).safeParse(data);
  if (result.success) return { ok: true, data: result.data as T };
  return { ok: false, issues: toIssues(result.error) };
}

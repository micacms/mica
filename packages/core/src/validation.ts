/**
 * Zod derivation.
 *
 * Zod is an implementation detail: the DSL is the public API because a field
 * descriptor carries editorial semantics (labels, groups, widths, presets) that
 * a validator cannot express. This module projects descriptors onto Zod for the
 * two shapes the system actually stores and serves.
 *
 *   storage — what lives in `entries.data`: media and relations are plain ids.
 *   output  — what the content API returns: media ids are expanded to objects.
 */

import { z } from "zod";

import type { AnyField, Collection, FieldMap, Singleton } from "./types.js";
import { isValidSlug } from "./slugify.js";

export type SchemaMode = "storage" | "output";

export interface SchemaOptions {
  /**
   * When false, `required` is not enforced and every field becomes nullable.
   *
   * Drafts use this: an editor must be able to save a half-finished entry and
   * come back tomorrow. Type and range rules still apply — only the presence
   * check is relaxed, and publishing re-validates strictly.
   */
  enforceRequired?: boolean;
}

export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const mediaRefSchema = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  size: z.number(),
  alt: z.string().nullable(),
});

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/* ------------------------------------------------------------------ */

/** Kinds whose empty state is a value, not null. */
function neverNull(field: AnyField): boolean {
  if (field.kind === "boolean" || field.kind === "repeater") return true;
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

/** The inner schema for a field, before nullability and defaults are applied. */
function innerSchema(
  field: AnyField,
  mode: SchemaMode,
  key: string,
  options: SchemaOptions,
): z.ZodType {
  const name = label(field, key);

  switch (field.kind) {
    case "text": {
      let schema = z.string().trim();
      if (field.minLength !== undefined) schema = schema.min(field.minLength);
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength);
      if (field.pattern) {
        schema = schema.regex(new RegExp(field.pattern), `${name} has an invalid format.`);
      }
      return schema;
    }

    case "textarea": {
      let schema = z.string();
      if (field.minLength !== undefined) schema = schema.min(field.minLength);
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength);
      return schema;
    }

    case "richText": {
      let schema = z.string();
      // maxLength counts the HTML source; generous limits are the point here.
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength);
      return schema;
    }

    case "number": {
      let schema = z.number({ error: `${name} must be a number.` }).finite();
      if (field.integer) schema = schema.int();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }

    case "boolean":
      return z.boolean();

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
        .max(field.maxLength ?? 96)
        .refine(isValidSlug, `${name} may only contain lowercase letters, numbers and hyphens.`);

    case "select": {
      const values = field.options.map((option) => option.value);
      const one = z.string().refine((value) => values.includes(value), {
        message: `${name} must be one of: ${values.join(", ")}.`,
      });
      return field.multiple ? z.array(one) : one;
    }

    case "color":
      return z.string().trim().regex(HEX_COLOR, `${name} must be a hex colour such as #1a2b3c.`);

    case "coordinates":
      return coordinatesSchema;

    case "media": {
      const one = mode === "output" ? mediaRefSchema : z.string().min(1);
      if (!field.multiple) return one;
      let list = z.array(one);
      if (field.max !== undefined) list = list.max(field.max);
      return list;
    }

    case "relation": {
      const one = z.string().min(1);
      return field.multiple ? z.array(one) : one;
    }

    case "object":
      return fieldsSchema(field.fields, mode, options);

    case "repeater": {
      let list = z.array(fieldsSchema(field.fields, mode, options));
      if (field.min !== undefined) list = list.min(field.min, `${name} needs at least ${field.min} entries.`);
      if (field.max !== undefined) list = list.max(field.max, `${name} allows at most ${field.max} entries.`);
      return list;
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
  mode: SchemaMode,
  key: string,
  options: SchemaOptions,
): z.ZodType {
  const name = label(field, key);
  const inner = innerSchema(field, mode, key, options);

  const normalise = (value: unknown): unknown => {
    if (value === undefined) return null;
    if (value === null) return null;
    if (typeof value === "string" && blankIsEmpty(field) && value.trim() === "") return null;
    return value;
  };

  if (neverNull(field)) {
    // A missing multi-value field is an empty list; a missing boolean is its default.
    const fallback: unknown = field.kind === "boolean" ? (field.default ?? false) : [];
    return z.preprocess((value) => (normalise(value) === null ? fallback : value), inner);
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
  mode: SchemaMode = "storage",
  options: SchemaOptions = {},
): z.ZodObject<z.ZodRawShape> {
  // Built as a mutable record: Zod 4's `ZodRawShape` is readonly, and it is the
  // shape `z.object` accepts rather than the one a caller assembles.
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) {
    shape[key] = fieldSchema(field, mode, key, options);
  }
  return z.object(shape).strip();
}

export function collectionSchema(
  def: Collection,
  mode: SchemaMode = "storage",
  options: SchemaOptions = {},
): z.ZodObject<z.ZodRawShape> {
  return fieldsSchema(def.fields, mode, options);
}

export function singletonSchema(
  def: Singleton,
  mode: SchemaMode = "storage",
  options: SchemaOptions = {},
): z.ZodObject<z.ZodRawShape> {
  return fieldsSchema(def.fields, mode, options);
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
  mode: SchemaMode = "storage",
  options: SchemaOptions = {},
): ValidationResult<T> {
  const result = fieldsSchema(fields, mode, options).safeParse(data);
  if (result.success) return { ok: true, data: result.data as T };
  return { ok: false, issues: toIssues(result.error) };
}

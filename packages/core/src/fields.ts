/**
 * Field builders.
 *
 * Each builder is a thin factory that stamps a `kind` onto its options and
 * returns the descriptor unchanged, so `JSON.stringify(site)` round-trips.
 *
 * `required` is a `boolean`: a generic keeps the literal `true` or `false`, which
 * is what lets `InferField` decide nullability. `multiple` stays `true |
 * undefined`, because a single value and a list are different shapes.
 */

import type {
  AnyField,
  BaseFieldOptions,
  BooleanField,
  ColorField,
  CoordinatesField,
  DateField,
  EmailField,
  FieldKind,
  MediaField,
  NumberField,
  ObjectField,
  RelationField,
  RepeaterField,
  RichTextField,
  SelectField,
  IdField,
  TagsField,
  TextareaField,
  TextField,
  UrlField,
} from "./types.js";

/**
 * Every field kind, as a runtime value.
 *
 * `FieldKind` alone is erased at compile time, which is no help to anything
 * that ingests a model as plain data — a schema loaded from disk or received
 * over the wire has to be checked against something. The `satisfies` clause
 * below is what keeps this list honest: adding a kind to the union without
 * adding it here stops compiling.
 */
const FIELD_KINDS = [
  "text",
  "textarea",
  "richText",
  "number",
  "boolean",
  "date",
  "email",
  "url",
  "id",
  "select",
  "object",
  "repeater",
  "relation",
  "media",
  "color",
  "coordinates",
  "tags",
] as const satisfies readonly FieldKind[];

// The converse direction: a kind removed from this list but still in the union
// would otherwise go unnoticed, since the array would remain assignable.
type _EveryKindListed = FieldKind extends (typeof FIELD_KINDS)[number] ? true : never;
const _everyKindListed: _EveryKindListed = true;
void _everyKindListed;

/** The options of every field, as runtime values: a reader names an option that this build does not know. */
export const COMMON_OPTIONS = ["kind", "label", "description", "required", "listed", "readonly", "hidden", "group", "width"] as const;

/** The options of each kind beside `COMMON_OPTIONS`. The checks below keep both lists complete. */
export const FIELD_OPTIONS = {
  text: ["minLength", "maxLength", "pattern", "patternMessage", "placeholder", "default"],
  textarea: ["minLength", "maxLength", "rows", "placeholder", "default"],
  richText: ["toolbar", "maxLength", "default"],
  number: ["min", "max", "step", "integer", "unit", "default"],
  boolean: ["default"],
  date: ["includeTime", "min", "max", "default"],
  email: ["placeholder", "default"],
  url: ["placeholder", "default"],
  id: ["from", "maxLength"],
  select: ["options", "multiple", "default"],
  object: ["fields", "collapsible", "collapsed"],
  repeater: ["fields", "min", "max", "itemLabel", "addLabel"],
  relation: ["collection", "multiple"],
  media: ["multiple", "accept", "max", "alt"],
  color: ["presets", "default"],
  coordinates: ["map"],
  tags: ["max", "maxLength", "suggestions", "default"],
} as const satisfies { [K in FieldKind]: readonly Exclude<keyof Extract<AnyField, { kind: K }>, (typeof COMMON_OPTIONS)[number]>[] };

// An option added to a field type but not listed here would make every editor treat it as unknown.
type Unlisted = {
  [K in FieldKind]: Exclude<keyof Extract<AnyField, { kind: K }>, (typeof COMMON_OPTIONS)[number] | (typeof FIELD_OPTIONS)[K][number]>;
}[FieldKind];
const _everyOptionListed: [Unlisted] extends [never] ? true : never = true;
void _everyOptionListed;

export function isFieldKind(value: unknown): value is FieldKind {
  return typeof value === "string" && (FIELD_KINDS as readonly string[]).includes(value);
}

/** Options shared by every builder. */
export type CommonOptions = BaseFieldOptions;

const make = <K extends string, O extends object>(kind: K, options?: O): { kind: K } & O =>
  ({ kind, ...(options ?? ({} as O)) }) as { kind: K } & O;

/* ------------------------------------------------------------------ */

export type TextOptions = Omit<TextField, "kind">;

/** One line of plain text. */
export function text<O extends TextOptions>(options?: O): TextField & O {
  return make("text", options) as TextField & O;
}

export type TextareaOptions = Omit<TextareaField, "kind">;

/** Plain text with line breaks, and no formatting. */
export function textarea<O extends TextareaOptions>(options?: O): TextareaField & O {
  return make("textarea", options) as TextareaField & O;
}

export type RichTextOptions = Omit<RichTextField, "kind">;

/** Formatted text, stored as Markdoc in its own `.mdoc` file beside the entry. */
export function richText<O extends RichTextOptions>(options?: O): RichTextField & O {
  return make("richText", options) as RichTextField & O;
}

export type NumberOptions = Omit<NumberField, "kind">;

/** A number. */
export function number<O extends NumberOptions>(options?: O): NumberField & O {
  return make("number", options) as NumberField & O;
}

export type BooleanOptions = Omit<BooleanField, "kind">;

/** Yes or no. Never null. */
export function boolean<O extends BooleanOptions>(options?: O): BooleanField & O {
  return make("boolean", options) as BooleanField & O;
}

export type DateOptions = Omit<DateField, "kind">;

/** A calendar date (`YYYY-MM-DD`), or with `includeTime` a timestamp. */
export function date<O extends DateOptions>(options?: O): DateField & O {
  return make("date", options) as DateField & O;
}

export type EmailOptions = Omit<EmailField, "kind">;

/** An email address, stored in lower case. */
export function email<O extends EmailOptions>(options?: O): EmailField & O {
  return make("email", options) as EmailField & O;
}

export type UrlOptions = Omit<UrlField, "kind">;

/** A web address that starts with `http://` or `https://`. */
export function url<O extends UrlOptions>(options?: O): UrlField & O {
  return make("url", options) as UrlField & O;
}

export type IdOptions = Omit<IdField, "kind">;

/**
 * An entry's ID: lower-case letters, digits and hyphens. Among a collection's
 * own fields, it is the name of the entry's folder, so it is never null; the
 * collection's `url` puts it into the page's address as `{id}`. Elsewhere, such
 * as one per language in an object, it is an ordinary value.
 */
export function id<O extends IdOptions>(options?: O): IdField & O {
  return make("id", options) as IdField & O;
}

export type SelectOptions = Omit<SelectField, "kind">;

/** One choice from a fixed list, or several with `multiple`. */
export function select<O extends SelectOptions>(options: O): SelectField & O {
  return make("select", options) as SelectField & O;
}

export type ObjectOptions = Omit<ObjectField, "kind">;

/**
 * A group of fields, stored as one object.
 *
 * `Omit<…, "fields">` matters for inference. Returning `ObjectField & O` would
 * intersect the caller's literal field map with the interface's broad
 * `FieldMap`, and `keyof` of that intersection collapses back to an index
 * signature — losing every child field type. Dropping `fields` from the left
 * side leaves the literal map as the only declaration of that property.
 */
export function object<O extends ObjectOptions>(options: O): Omit<ObjectField, "fields"> & O {
  return make("object", options) as Omit<ObjectField, "fields"> & O;
}

export type RepeaterOptions = Omit<RepeaterField, "kind">;

/** A list of rows with the same fields. See `object` for why `fields` is omitted from the left side. */
export function repeater<O extends RepeaterOptions>(options: O): Omit<RepeaterField, "fields"> & O {
  return make("repeater", options) as Omit<RepeaterField, "fields"> & O;
}

export type RelationOptions = Omit<RelationField, "kind">;

/** A link to an entry of another collection, or of the same one. */
export function relation<O extends RelationOptions>(options: O): RelationField & O {
  return make("relation", options) as RelationField & O;
}

export type MediaOptions = Omit<MediaField, "kind">;

/** A file in the content repository: in the entry's own `media/` folder, or in the shared one. */
export function media<O extends MediaOptions>(options?: O): MediaField & O {
  return make("media", options) as MediaField & O;
}

export type ColorOptions = Omit<ColorField, "kind">;

/** A colour, stored as a hex value such as `#1a2b3c`. */
export function color<O extends ColorOptions>(options?: O): ColorField & O {
  return make("color", options) as ColorField & O;
}

export type CoordinatesOptions = Omit<CoordinatesField, "kind">;

export type TagsOptions = Omit<TagsField, "kind">;

/** A free list of short words, such as tags or keywords, in the order the editor gave them. Never null: empty is `[]`. */
export function tags<O extends TagsOptions>(options?: O): TagsField & O {
  return make("tags", options) as TagsField & O;
}

/** A place, stored as `{ lat, lng }`. */
export function coordinates<O extends CoordinatesOptions>(options?: O): CoordinatesField & O {
  return make("coordinates", options) as CoordinatesField & O;
}

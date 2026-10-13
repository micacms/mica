/**
 * Field builders.
 *
 * Each builder is a thin factory that stamps a `kind` onto its options and
 * returns the descriptor unchanged, so `JSON.stringify(site)` round-trips.
 *
 * `required` and `multiple` are typed as `true | undefined` rather than
 * `boolean`. Declaring `required: false` carries no meaning, and constraining
 * them to a literal keeps TypeScript from widening `true` to `boolean` during
 * inference — which is what lets `InferField` decide nullability.
 */

import type {
  BooleanField,
  ColorField,
  CoordinatesField,
  DateField,
  EmailField,
  FieldKind,
  FieldMap,
  MediaField,
  NumberField,
  ObjectField,
  RelationField,
  RepeaterField,
  RichTextFeature,
  RichTextField,
  SelectField,
  SelectOption,
  SlugField,
  TextField,
  TextareaField,
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
export const FIELD_KINDS = [
  "text",
  "textarea",
  "richText",
  "number",
  "boolean",
  "date",
  "email",
  "url",
  "slug",
  "select",
  "object",
  "repeater",
  "relation",
  "media",
  "color",
  "coordinates",
] as const satisfies readonly FieldKind[];

// The converse direction: a kind removed from this list but still in the union
// would otherwise go unnoticed, since the array would remain assignable.
type _EveryKindListed = FieldKind extends (typeof FIELD_KINDS)[number] ? true : never;
const _everyKindListed: _EveryKindListed = true;
void _everyKindListed;

export function isFieldKind(value: unknown): value is FieldKind {
  return typeof value === "string" && (FIELD_KINDS as readonly string[]).includes(value);
}

/** Options shared by every builder. */
export interface CommonOptions {
  label?: string;
  description?: string;
  required?: true;
  listed?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  group?: string;
  width?: "full" | "half" | "third";
}

const make = <K extends string, O extends object>(kind: K, options?: O): { kind: K } & O =>
  ({ kind, ...(options ?? ({} as O)) }) as { kind: K } & O;

/* ------------------------------------------------------------------ */

export interface TextOptions extends CommonOptions {
  minLength?: number;
  maxLength?: number;
  /** A regular expression that must match the whole value, with the `u` flag. */
  pattern?: string;
  placeholder?: string;
  default?: string;
}

export function text<O extends TextOptions>(options?: O): TextField & O {
  return make("text", options) as TextField & O;
}

export interface TextareaOptions extends CommonOptions {
  minLength?: number;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  default?: string;
}

export function textarea<O extends TextareaOptions>(options?: O): TextareaField & O {
  return make("textarea", options) as TextareaField & O;
}

export interface RichTextOptions extends CommonOptions {
  toolbar?: RichTextFeature[];
  maxLength?: number;
  default?: string;
}

export function richText<O extends RichTextOptions>(options?: O): RichTextField & O {
  return make("richText", options) as RichTextField & O;
}

export interface NumberOptions extends CommonOptions {
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  unit?: string;
  default?: number;
}

export function number<O extends NumberOptions>(options?: O): NumberField & O {
  return make("number", options) as NumberField & O;
}

export interface BooleanOptions extends CommonOptions {
  default?: boolean;
}

export function boolean<O extends BooleanOptions>(options?: O): BooleanField & O {
  return make("boolean", options) as BooleanField & O;
}

export interface DateOptions extends CommonOptions {
  includeTime?: boolean;
  min?: string;
  max?: string;
  default?: string;
}

export function date<O extends DateOptions>(options?: O): DateField & O {
  return make("date", options) as DateField & O;
}

export interface EmailOptions extends CommonOptions {
  placeholder?: string;
  default?: string;
}

export function email<O extends EmailOptions>(options?: O): EmailField & O {
  return make("email", options) as EmailField & O;
}

export interface UrlOptions extends CommonOptions {
  placeholder?: string;
  default?: string;
}

export function url<O extends UrlOptions>(options?: O): UrlField & O {
  return make("url", options) as UrlField & O;
}

export interface SlugOptions extends CommonOptions {
  /** Sibling field key the slug is generated from as the editor types. */
  from?: string;
  maxLength?: number;
}

export function slug<O extends SlugOptions>(options?: O): SlugField & O {
  return make("slug", options) as SlugField & O;
}

export interface SelectOptions extends CommonOptions {
  options: SelectOption[];
  multiple?: true;
  default?: string | string[];
}

export function select<O extends SelectOptions>(options: O): SelectField & O {
  return make("select", options) as SelectField & O;
}

export interface ObjectOptions extends CommonOptions {
  fields: FieldMap;
  collapsible?: boolean;
  collapsed?: boolean;
}

/**
 * `Omit<…, "fields">` matters for inference. Returning `ObjectField & O` would
 * intersect the caller's literal field map with the interface's broad
 * `FieldMap`, and `keyof` of that intersection collapses back to an index
 * signature — losing every child field type. Dropping `fields` from the left
 * side leaves the literal map as the only declaration of that property.
 */
export function object<O extends ObjectOptions>(options: O): Omit<ObjectField, "fields"> & O {
  return make("object", options) as Omit<ObjectField, "fields"> & O;
}

export interface RepeaterOptions extends CommonOptions {
  fields: FieldMap;
  min?: number;
  max?: number;
  /** Child field key used as the row summary. */
  itemLabel?: string;
  addLabel?: string;
}

/** See `object` for why `fields` is omitted from the left side. */
export function repeater<O extends RepeaterOptions>(options: O): Omit<RepeaterField, "fields"> & O {
  return make("repeater", options) as Omit<RepeaterField, "fields"> & O;
}

export interface RelationOptions extends CommonOptions {
  /** Target collection name. Values are entry slugs. */
  collection: string;
  multiple?: true;
}

export function relation<O extends RelationOptions>(options: O): RelationField & O {
  return make("relation", options) as RelationField & O;
}

export interface MediaOptions extends CommonOptions {
  multiple?: true;
  accept?: "image" | "document" | "any";
  max?: number;
  /** Stores `{ path, alt }` and asks for alt text. `"required"` refuses an empty one. */
  alt?: "required" | "optional";
}

export function media<O extends MediaOptions>(options?: O): MediaField & O {
  return make("media", options) as MediaField & O;
}

export interface ColorOptions extends CommonOptions {
  presets?: string[];
  default?: string;
}

export function color<O extends ColorOptions>(options?: O): ColorField & O {
  return make("color", options) as ColorField & O;
}

export interface CoordinatesOptions extends CommonOptions {
  defaultCenter?: { lat: number; lng: number };
  defaultZoom?: number;
}

export function coordinates<O extends CoordinatesOptions>(options?: O): CoordinatesField & O {
  return make("coordinates", options) as CoordinatesField & O;
}

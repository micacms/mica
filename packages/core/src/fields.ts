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
  TagsField,
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
  "tags",
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
  /** The label in the editor. Defaults to the field key, in words: `metaTitle` is "Meta title". */
  label?: string;
  /** Help text under the input. */
  description?: string;
  /** Publish refuses an empty value. A draft may still be saved without it. The value's type is then not nullable. */
  required?: boolean;
  /** Shown as a column in the collection's list. */
  listed?: boolean;
  /** Shown, but the editor cannot change it. */
  readonly?: boolean;
  /** Kept in the content, but not shown in the editor. */
  hidden?: boolean;
  /** Fields with the same group, one after another, are shown in one box with this heading. */
  group?: string;
  /** How much of the form's width the field takes. Defaults to `"full"`. */
  width?: "full" | "half" | "third";
}

const make = <K extends string, O extends object>(kind: K, options?: O): { kind: K } & O =>
  ({ kind, ...(options ?? ({} as O)) }) as { kind: K } & O;

/* ------------------------------------------------------------------ */

export interface TextOptions extends CommonOptions {
  /** The fewest characters, after trimming. */
  minLength?: number;
  /** The most characters, after trimming. */
  maxLength?: number;
  /** A regular expression that must match the whole value, with the `u` flag. */
  pattern?: string;
  /** What the editor reads when the value does not match `pattern`. */
  patternMessage?: string;
  /** Example text in the empty input. */
  placeholder?: string;
  /** The value of a new entry. */
  default?: string;
}

/** One line of plain text. */
export function text<O extends TextOptions>(options?: O): TextField & O {
  return make("text", options) as TextField & O;
}

export interface TextareaOptions extends CommonOptions {
  /** The fewest characters. */
  minLength?: number;
  /** The most characters. */
  maxLength?: number;
  /** The height of the input, in lines. Defaults to 4. */
  rows?: number;
  /** Example text in the empty input. */
  placeholder?: string;
  /** The value of a new entry. */
  default?: string;
}

/** Plain text with line breaks, and no formatting. */
export function textarea<O extends TextareaOptions>(options?: O): TextareaField & O {
  return make("textarea", options) as TextareaField & O;
}

export interface RichTextOptions extends CommonOptions {
  /** The buttons and typing shortcuts the editor offers. Text that uses others still loads. Defaults to bold, italic, heading, lists and link. */
  toolbar?: RichTextFeature[];
  /** The most characters of the Markdoc source. */
  maxLength?: number;
  /** The Markdoc of a new entry. */
  default?: string;
}

/** Formatted text, stored as Markdoc in its own `.mdoc` file beside the entry. */
export function richText<O extends RichTextOptions>(options?: O): RichTextField & O {
  return make("richText", options) as RichTextField & O;
}

export interface NumberOptions extends CommonOptions {
  /** The smallest value. */
  min?: number;
  /** The largest value. */
  max?: number;
  /** The step of the input's arrows. */
  step?: number;
  /** Only whole numbers. */
  integer?: boolean;
  /** Shown after the input, such as `"m²"` or `"CHF"`. Not stored. */
  unit?: string;
  /** The value of a new entry. */
  default?: number;
}

/** A number. */
export function number<O extends NumberOptions>(options?: O): NumberField & O {
  return make("number", options) as NumberField & O;
}

export interface BooleanOptions extends CommonOptions {
  /** The value of a new entry. Defaults to `false`. */
  default?: boolean;
}

/** Yes or no. Never null. */
export function boolean<O extends BooleanOptions>(options?: O): BooleanField & O {
  return make("boolean", options) as BooleanField & O;
}

export interface DateOptions extends CommonOptions {
  /** Store a time too: an ISO 8601 timestamp with its offset instead of `YYYY-MM-DD`. */
  includeTime?: boolean;
  /** The earliest value, in the stored form. */
  min?: string;
  /** The latest value, in the stored form. */
  max?: string;
  /** The value of a new entry, in the stored form. */
  default?: string;
}

/** A calendar date (`YYYY-MM-DD`), or with `includeTime` a timestamp. */
export function date<O extends DateOptions>(options?: O): DateField & O {
  return make("date", options) as DateField & O;
}

export interface EmailOptions extends CommonOptions {
  /** Example text in the empty input. */
  placeholder?: string;
  /** The value of a new entry. */
  default?: string;
}

/** An email address, stored in lower case. */
export function email<O extends EmailOptions>(options?: O): EmailField & O {
  return make("email", options) as EmailField & O;
}

export interface UrlOptions extends CommonOptions {
  /** Example text in the empty input. */
  placeholder?: string;
  /** The value of a new entry. */
  default?: string;
}

/** A web address that starts with `http://` or `https://`. */
export function url<O extends UrlOptions>(options?: O): UrlField & O {
  return make("url", options) as UrlField & O;
}

export interface SlugOptions extends CommonOptions {
  /** The field that a new entry's URL follows while the editor types, until the editor changes the URL. */
  from?: string;
  /** The most characters. Defaults to 96. */
  maxLength?: number;
}

/**
 * An entry's URL: lower-case letters, digits and hyphens. Among a collection's
 * own fields, it is the entry's file name, so it is never null. Elsewhere, such
 * as one per language in an object, it is an ordinary value.
 */
export function slug<O extends SlugOptions>(options?: O): SlugField & O {
  return make("slug", options) as SlugField & O;
}

export interface SelectOptions extends CommonOptions {
  /** The choices: the stored `value` and the `label` the editor reads. */
  options: SelectOption[];
  /** Several choices, stored as a list. */
  multiple?: true;
  /** The value of a new entry: a value, or a list with `multiple`. */
  default?: string | string[];
}

/** One choice from a fixed list, or several with `multiple`. */
export function select<O extends SelectOptions>(options: O): SelectField & O {
  return make("select", options) as SelectField & O;
}

export interface ObjectOptions extends CommonOptions {
  /** The fields of the group. */
  fields: FieldMap;
  /** The editor can fold the group away. */
  collapsible?: boolean;
  /** Folded when the form opens. Needs `collapsible`. */
  collapsed?: boolean;
}

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

export interface RepeaterOptions extends CommonOptions {
  /** The fields of each row. */
  fields: FieldMap;
  /** The fewest rows. */
  min?: number;
  /** The most rows. */
  max?: number;
  /** The field of a row that names the row in the editor. */
  itemLabel?: string;
  /** The text of the button that adds a row. Defaults to "Add item". */
  addLabel?: string;
}

/** A list of rows with the same fields. See `object` for why `fields` is omitted from the left side. */
export function repeater<O extends RepeaterOptions>(options: O): Omit<RepeaterField, "fields"> & O {
  return make("repeater", options) as Omit<RepeaterField, "fields"> & O;
}

export interface RelationOptions extends CommonOptions {
  /** The collection the links point into. The stored value is the target's URL (slug). */
  collection: string;
  /** Several links, stored as a list in the editor's order. */
  multiple?: true;
}

/** A link to an entry of another collection, or of the same one. */
export function relation<O extends RelationOptions>(options: O): RelationField & O {
  return make("relation", options) as RelationField & O;
}

export interface MediaOptions extends CommonOptions {
  /** Several files, stored as a list in the editor's order. */
  multiple?: true;
  /** The kind of file: images (JPEG, PNG, GIF, WebP, AVIF), PDF documents, or both. Defaults to `"any"`. In Astro, an image field is an Astro image. */
  accept?: "image" | "document" | "any";
  /** The most files, with `multiple`. */
  max?: number;
  /** Stores `{ path, alt }` and asks for alt text. `"required"` refuses an empty one. */
  alt?: "required" | "optional";
}

/** A file in the content repository: in the entry's own `media/` folder, or in the shared one. */
export function media<O extends MediaOptions>(options?: O): MediaField & O {
  return make("media", options) as MediaField & O;
}

export interface ColorOptions extends CommonOptions {
  /** Colours offered with one click, as hex values. */
  presets?: string[];
  /** The value of a new entry, as a hex value. */
  default?: string;
}

/** A colour, stored as a hex value such as `#1a2b3c`. */
export function color<O extends ColorOptions>(options?: O): ColorField & O {
  return make("color", options) as ColorField & O;
}

export type CoordinatesOptions = CommonOptions;

export interface TagsOptions extends CommonOptions {
  /** The most tags. */
  max?: number;
  /** The most characters of one tag. */
  maxLength?: number;
  /** Tags the editor is offered while typing; others are allowed too. */
  suggestions?: string[];
  /** The tags of a new entry. */
  default?: string[];
}

/** A free list of short words, such as tags or keywords, in the order the editor gave them. Never null: empty is `[]`. */
export function tags<O extends TagsOptions>(options?: O): TagsField & O {
  return make("tags", options) as TagsField & O;
}

/** A place, stored as `{ lat, lng }`. */
export function coordinates<O extends CoordinatesOptions>(options?: O): CoordinatesField & O {
  return make("coordinates", options) as CoordinatesField & O;
}

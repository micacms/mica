/**
 * Field descriptors for the Mica content model.
 *
 * Every descriptor is plain, JSON-serialisable data. That is a hard constraint:
 * the admin SPA fetches the whole model over HTTP and renders forms from it, so
 * a descriptor must never contain functions, class instances or symbols.
 */

export type FieldKind =
  | "text"
  | "textarea"
  | "richText"
  | "number"
  | "boolean"
  | "date"
  | "email"
  | "url"
  | "slug"
  | "select"
  | "object"
  | "repeater"
  | "relation"
  | "media"
  | "color"
  | "coordinates";

/** Options shared by every field type. */
export interface BaseFieldOptions {
  /** Human readable label shown in the editor. Falls back to the field key. */
  label?: string;
  /** Help text rendered below the input. */
  description?: string;
  /** Empty values are rejected by validation when true. */
  required?: boolean;
  /** Shown in list/table views for this collection. */
  listed?: boolean;
  /** Rendered but not editable. */
  readonly?: boolean;
  /** Kept in the payload but hidden from the editor. */
  hidden?: boolean;
  /** Layout hint for the generated form: fields sharing a group are boxed together. */
  group?: string;
  /** Fraction of the form row this field occupies. */
  width?: "full" | "half" | "third";
}

export interface BaseField extends BaseFieldOptions {
  kind: FieldKind;
}

export interface TextField extends BaseField {
  kind: "text";
  minLength?: number;
  maxLength?: number;
  /** A regular expression that must match the whole value, with the `u` flag, e.g. `"[A-Z]{2}"`. */
  pattern?: string;
  /** What the editor reads when the value does not match `pattern`, e.g. "Use two capital letters, like CH." */
  patternMessage?: string;
  placeholder?: string;
  default?: string;
}

export interface TextareaField extends BaseField {
  kind: "textarea";
  minLength?: number;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  default?: string;
}

/** Rich text is stored as Markdoc, in a file beside the entry. */
export interface RichTextField extends BaseField {
  kind: "richText";
  /** Marks/nodes the editor toolbar offers. */
  toolbar?: RichTextFeature[];
  maxLength?: number;
  default?: string;
}

export type RichTextFeature =
  | "bold"
  | "italic"
  | "strike"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "link"
  | "horizontalRule";

export interface NumberField extends BaseField {
  kind: "number";
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  /** Suffix rendered inside the input, e.g. `"m²"`. */
  unit?: string;
  default?: number;
}

export interface BooleanField extends BaseField {
  kind: "boolean";
  default?: boolean;
}

export interface DateField extends BaseField {
  kind: "date";
  /** Store a full timestamp instead of a calendar date. */
  includeTime?: boolean;
  /** ISO 8601 bounds. */
  min?: string;
  max?: string;
  default?: string;
}

export interface EmailField extends BaseField {
  kind: "email";
  placeholder?: string;
  default?: string;
}

export interface UrlField extends BaseField {
  kind: "url";
  placeholder?: string;
  default?: string;
}

export interface SlugField extends BaseField {
  kind: "slug";
  /** Field key the slug is derived from while the editor types. */
  from?: string;
  maxLength?: number;
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectField extends BaseField {
  kind: "select";
  options: SelectOption[];
  multiple?: boolean;
  default?: string | string[];
}

export interface ObjectField extends BaseField {
  kind: "object";
  fields: FieldMap;
  /** Render the group as an expandable section. */
  collapsible?: boolean;
  collapsed?: boolean;
}

export interface RepeaterField extends BaseField {
  kind: "repeater";
  fields: FieldMap;
  min?: number;
  max?: number;
  /** Child field key used as the row summary in the collapsed list. */
  itemLabel?: string;
  /** Label of the "add" button. */
  addLabel?: string;
}

export interface RelationField extends BaseField {
  kind: "relation";
  /** Collection name the relation points at. Values are entry slugs. */
  collection: string;
  multiple?: boolean;
}

export interface MediaField extends BaseField {
  kind: "media";
  multiple?: boolean;
  /** Restricts the upload picker and server-side validation. */
  accept?: "image" | "document" | "any";
  /** Maximum number of items when `multiple` is set. */
  max?: number;
  /** Stores `{ path, alt }` and asks for alt text beside the preview. `"required"` refuses an empty one. */
  alt?: "required" | "optional";
}

/** What a `media({ alt })` field stores for one file. */
export interface MediaWithAlt {
  path: string;
  alt: string | null;
}

export interface ColorField extends BaseField {
  kind: "color";
  /** Swatches offered next to the picker. */
  presets?: string[];
  default?: string;
}

export interface CoordinatesField extends BaseField {
  kind: "coordinates";
}

export type AnyField =
  | TextField
  | TextareaField
  | RichTextField
  | NumberField
  | BooleanField
  | DateField
  | EmailField
  | UrlField
  | SlugField
  | SelectField
  | ObjectField
  | RepeaterField
  | RelationField
  | MediaField
  | ColorField
  | CoordinatesField;

export type FieldMap = Record<string, AnyField>;

/* ------------------------------------------------------------------ *
 * Collections, singletons and the site model
 * ------------------------------------------------------------------ */

export interface CollectionOptions {
  label: string;
  /** Singular label used for buttons like "New project". */
  labelSingular?: string;
  description?: string;
  /** Field key rendered as the entry title in lists. Defaults to `title`. */
  titleField?: string;
  /** Field key holding the URL slug. Defaults to the first `slug` field. */
  slugField?: string;
  fields: FieldMap;
  defaultSort?: { field: SortField; direction: "asc" | "desc" };
  /** Ordering the editor can rearrange by hand. */
  sortable?: boolean;
}

/**
 * What a collection is listed by before an editor sorts it themselves.
 *
 * Either `"position"` — the order they arranged by hand, kept in
 * `_order.json` — or the key of a field this collection declares.
 *
 * A name from the model can be checked against the model; a name from a fixed
 * list cannot.
 */
export type SortField = "position" | (string & {});

export interface Collection extends CollectionOptions {
  type: "collection";
  /** Injected by `defineSite` from the key in the `collections` map. */
  name: string;
}

export interface SingletonOptions {
  label: string;
  description?: string;
  fields: FieldMap;
}

export interface Singleton extends SingletonOptions {
  type: "singleton";
  /** Injected by `defineSite` from the key in the `singletons` map. */
  name: string;
}

export interface SiteOptions {
  /**
   * Where this site's content lives, relative to the Astro project root.
   *
   * Part of the site rather than of each consumer, because the collections,
   * the dev integration and the image resolution all have to agree on it, and
   * a disagreement between them produces an empty build rather than an error.
   *
   * Local to the project and therefore *not* part of the protocol manifest —
   * a Mica deployment is told where content lives by its own configuration.
   */
  root?: string;
  collections: Record<string, Collection>;
  singletons?: Record<string, Singleton>;
}

export interface Site<
  C extends Record<string, Collection> = Record<string, Collection>,
  S extends Record<string, Singleton> = Record<string, Singleton>,
> {
  /** See `SiteOptions.root`. Absent in a model read back from a manifest. */
  root?: string;
  collections: C;
  singletons: S;
}

/* ------------------------------------------------------------------ *
 * Values that are not scalars
 * ------------------------------------------------------------------ */

export interface Coordinates {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ *
 * Type inference
 * ------------------------------------------------------------------ */

type Multiple<F, T> = F extends { multiple: true } ? T[] : T;

// prettier-ignore
type StoredMedia<F> =
  F extends { alt: "required" } ? { path: string; alt: string } :
  F extends { alt: "optional" } ? MediaWithAlt :
  string;

/**
 * `Img` is the type of an image that a site framework resolves, such as Astro's
 * `ImageMetadata`. With it, `media({ accept: "image" })` is that image, and
 * with `alt`, `{ src, alt }`. Without it (`never`), every media value is stored.
 */
// prettier-ignore
type MediaValue<F, Img> =
  [Img] extends [never] ? StoredMedia<F> :
  F extends { accept: "image"; alt: "required" | "optional" } ? { src: Img; alt: string } :
  F extends { accept: "image" } ? Img :
  StoredMedia<F>;

/** The runtime value of a field, ignoring nullability. */
// prettier-ignore
export type FieldValue<F extends AnyField, Img = never> =
  F extends TextField ? string :
  F extends TextareaField ? string :
  F extends RichTextField ? string :
  F extends NumberField ? number :
  F extends BooleanField ? boolean :
  F extends DateField ? string :
  F extends EmailField ? string :
  F extends UrlField ? string :
  F extends SlugField ? string :
  F extends SelectField ? Multiple<F, string> :
  F extends ColorField ? string :
  F extends CoordinatesField ? Coordinates :
  // A path into the content repository; with the `alt` option, the path and its alt text.
  F extends MediaField ? Multiple<F, MediaValue<F, Img>> :
  F extends RelationField ? Multiple<F, string> :
  F extends ObjectField ? InferFields<F["fields"], Img> :
  F extends RepeaterField ? Array<InferFields<F["fields"], Img>> :
  never;

/**
 * Booleans, repeaters and multi-value fields always have a concrete empty
 * representation, so they are never null. A collection's own slug field is the
 * entry's file name (`Url`), so it is never null either; a slug elsewhere, such
 * as one per language in an object, can be. Everything else is nullable unless
 * declared `required: true`.
 */
// prettier-ignore
type NeverNull<F extends AnyField, Url extends boolean> =
  F extends BooleanField ? true :
  F extends RepeaterField ? true :
  F extends { multiple: true } ? true :
  F extends { required: true } ? true :
  F extends SlugField ? Url :
  false;

/** `Url`: the field is among a collection's own fields, where a slug is the entry's URL. */
export type InferField<F extends AnyField, Img = never, Url extends boolean = false> = NeverNull<F, Url> extends true
  ? FieldValue<F, Img>
  : FieldValue<F, Img> | null;

export type InferFields<M extends FieldMap, Img = never, Url extends boolean = false> = {
  [K in keyof M]: InferField<M[K], Img, Url>;
};

export type InferCollection<C extends Collection, Img = never> = InferFields<C["fields"], Img, true>;
export type InferSingleton<S extends Singleton, Img = never> = InferFields<S["fields"], Img>;

/** `{ projects: {...}, news: {...} }` — data shapes keyed by collection name. */
export type InferSiteCollections<S extends Site> = {
  [K in keyof S["collections"]]: InferCollection<S["collections"][K]>;
};

export type InferSiteSingletons<S extends Site> = {
  [K in keyof S["singletons"]]: InferSingleton<S["singletons"][K]>;
};

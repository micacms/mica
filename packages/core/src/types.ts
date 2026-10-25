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
  | "coordinates"
  | "tags";

/**
 * Options shared by every field type. The builders in `fields.ts` take the
 * options of a field type without its `kind`: one declaration for both.
 */
export interface BaseFieldOptions {
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

export interface BaseField extends BaseFieldOptions {
  kind: FieldKind;
}

export interface TextField extends BaseField {
  kind: "text";
  /** The fewest characters, after trimming. */
  minLength?: number;
  /** The most characters, after trimming. */
  maxLength?: number;
  /** A regular expression that must match the whole value, with the `u` flag, e.g. `"[A-Z]{2}"`. */
  pattern?: string;
  /** What the editor reads when the value does not match `pattern`, e.g. "Use two capital letters, like CH." */
  patternMessage?: string;
  /** Example text in the empty input. */
  placeholder?: string;
  /** The value of a new entry. */
  default?: string;
}

export interface TextareaField extends BaseField {
  kind: "textarea";
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

/** Rich text is stored as Markdoc, in a file beside the entry. */
export interface RichTextField extends BaseField {
  kind: "richText";
  /**
   * The buttons and typing shortcuts the editor offers: `"minimal"` (bold, italic, link), `"default"` (also headings
   * and lists), `"full"` (also quote, strikethrough, divider, table and image), or a list of features. Text that uses
   * others still loads.
   */
  toolbar?: RichTextToolbar;
  /** The most characters of the Markdoc source. */
  maxLength?: number;
  /** The Markdoc of a new entry. */
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
  | "horizontalRule"
  /** A table with a header row; each cell holds one line of text. Stored as a Markdown pipe table. */
  | "table"
  /** An image from the media library, with alt text, on a line of its own. */
  | "image";

/**
 * A preset or a list of features. `"minimal"`: bold, italic and links.
 * `"default"`: also headings and lists. `"full"`: every feature.
 */
export type RichTextToolbar = "minimal" | "default" | "full" | RichTextFeature[];

export interface NumberField extends BaseField {
  kind: "number";
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

export interface BooleanField extends BaseField {
  kind: "boolean";
  /** The value of a new entry. Defaults to `false`. */
  default?: boolean;
}

export interface DateField extends BaseField {
  kind: "date";
  /** Store a time too: an ISO 8601 timestamp with its offset instead of `YYYY-MM-DD`. */
  includeTime?: boolean;
  /** The earliest value, in the stored form. A date without a time compares the calendar date. */
  min?: string;
  /** The latest value, in the stored form. A date without a time compares the calendar date. */
  max?: string;
  /** The value of a new entry, in the stored form. */
  default?: string;
}

export interface EmailField extends BaseField {
  kind: "email";
  /** Example text in the empty input. */
  placeholder?: string;
  /** The value of a new entry. */
  default?: string;
}

export interface UrlField extends BaseField {
  kind: "url";
  /** Example text in the empty input. */
  placeholder?: string;
  /** The value of a new entry. */
  default?: string;
}

export interface SlugField extends BaseField {
  kind: "slug";
  /** The field that a new entry's URL follows while the editor types, until the editor changes the URL. */
  from?: string;
  /** The most characters. Defaults to 96. */
  maxLength?: number;
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectField extends BaseField {
  kind: "select";
  /** The choices: the stored `value` and the `label` the editor reads. */
  options: SelectOption[];
  /** Several choices, stored as a list. */
  multiple?: true;
  /** The value of a new entry: a value, or a list with `multiple`. */
  default?: string | string[];
}

export interface ObjectField extends BaseField {
  kind: "object";
  /** The fields of the group. */
  fields: FieldMap;
  /** The editor can fold the group away. */
  collapsible?: boolean;
  /** Folded when the form opens. Needs `collapsible`. */
  collapsed?: boolean;
}

export interface RepeaterField extends BaseField {
  kind: "repeater";
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

export interface RelationField extends BaseField {
  kind: "relation";
  /** The collection the links point into. The stored value is the target's URL (slug). */
  collection: string;
  /** Several links, stored as a list in the editor's order. */
  multiple?: true;
}

export interface MediaField extends BaseField {
  kind: "media";
  /** Several files, stored as a list in the editor's order. */
  multiple?: true;
  /**
   * The kind of file: `"image"` (JPEG, PNG, GIF, WebP, AVIF), `"document"` (PDF), `"any"` (every type that Mica knows), or a
   * list of types such as `["gpx", "kml"]`. Defaults to `"any"`. In Astro, only `"image"` makes an Astro image.
   */
  accept?: MediaAccept;
  /** The most files, with `multiple`. */
  max?: number;
  /** Stores `{ path, alt }` and asks for alt text. `"required"` refuses an empty one. */
  alt?: "required" | "optional";
}

/** A type of file that Mica knows. `"image"` is JPEG, PNG, GIF, WebP and AVIF. */
export type MediaFileType = "image" | "pdf" | "gpx" | "kml" | "geojson" | "zip" | "csv";

/** What a `media()` field accepts: a group, or a list of types. */
export type MediaAccept = "image" | "document" | "any" | MediaFileType[];

/** What a `media({ alt })` field stores for one file. */
export interface MediaWithAlt {
  path: string;
  alt: string | null;
}

export interface ColorField extends BaseField {
  kind: "color";
  /** Colours offered with one click, as hex values. */
  presets?: string[];
  /** The value of a new entry, as a hex value. */
  default?: string;
}

/** An OpenFreeMap style, loaded from `https://tiles.openfreemap.org/styles/<name>`. */
export type MapPreset = "liberty" | "bright" | "positron";

/** A map style of your own. The model is public with the content, so a key in `style` is public too. */
export interface MapStyle {
  /** The `https` address of the MapLibre style JSON. */
  style: string;
  /** The other `https` origins that the style loads tiles, glyphs and sprites from. The origin of `style` is always allowed. */
  hosts?: string[];
}

export interface CoordinatesField extends BaseField {
  kind: "coordinates";
  /** Shows a map below the inputs, to pick the place. The editor's browser loads the style and tiles from its host. */
  map?: MapPreset | MapStyle;
}

/** A free list of short words, such as tags or keywords. Stored as a list of strings. */
export interface TagsField extends BaseField {
  kind: "tags";
  /** The most tags. */
  max?: number;
  /** The most characters of one tag. */
  maxLength?: number;
  /** Tags the editor is offered while typing; others are allowed too. */
  suggestions?: string[];
  /** The tags of a new entry. */
  default?: string[];
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
  | CoordinatesField
  | TagsField;

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
  /** The page of an entry on the website, such as `/news/{slug}`. With `MICA_SITE_URL`, the editor links to it. */
  url?: string;
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
  /** Its page on the website, such as `/about`. With `MICA_SITE_URL`, the editor links to it. */
  url?: string;
}

export interface Singleton extends SingletonOptions {
  type: "singleton";
  /** Injected by `defineSite` from the key in the `singletons` map. */
  name: string;
}

/**
 * Data that the website reads from a file and Mica never edits, such as place
 * names or regions. A relation can point to it as to a collection; its name is
 * the name of the website's own Astro collection for the file.
 */
export interface ReferenceSetOptions {
  label: string;
  /** The file, from the Astro project root: JSON (a list, or an object by id) or CSV with a header row. */
  file: string;
  /** The key of an item's id. Default: `id`. */
  id?: string;
  /** The key of an item's title. Default: `title`, else the id. */
  title?: string;
}

export interface ReferenceSet extends ReferenceSetOptions {
  type: "reference";
  /** Injected by `defineSite` from the key in the `references` map. */
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
  /** The website's name for its editors, such as "Harbor Lane Consulting": the editor shows it at the top of its menu. */
  label?: string;
  collections: Record<string, Collection>;
  singletons?: Record<string, Singleton>;
  references?: Record<string, ReferenceSet>;
}

export interface Site<
  C extends Record<string, Collection> = Record<string, Collection>,
  S extends Record<string, Singleton> = Record<string, Singleton>,
> {
  /** See `SiteOptions.root`. Absent in a model read back from a manifest. */
  root?: string;
  /** See `SiteOptions.label`. */
  label?: string;
  collections: C;
  singletons: S;
  /** The reference sets, when the model has any. */
  references?: Record<string, ReferenceSet>;
}

/* ------------------------------------------------------------------ *
 * Values that are not scalars
 * ------------------------------------------------------------------ */

export interface Coordinates {
  lat: number;
  lng: number;
  /** The zoom of the map when the place was set, from 0 to 22. Only a field with a map stores it. */
  zoom?: number;
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
  F extends TagsField ? string[] :
  // A path into the content repository; with the `alt` option, the path and its alt text.
  F extends MediaField ? Multiple<F, MediaValue<F, Img>> :
  F extends RelationField ? Multiple<F, string> :
  F extends ObjectField ? InferFields<F["fields"], Img> :
  F extends RepeaterField ? Array<InferFields<F["fields"], Img>> :
  never;

/**
 * Booleans, objects, repeaters and multi-value fields always have a concrete
 * empty representation, so they are never null. A collection's own slug field is the
 * entry's file name (`Url`), so it is never null either; a slug elsewhere, such
 * as one per language in an object, can be. Everything else is nullable unless
 * declared `required: true`.
 */
// prettier-ignore
type NeverNull<F extends AnyField, Url extends boolean> =
  F extends BooleanField ? true :
  F extends RepeaterField ? true :
  F extends ObjectField ? true :
  F extends TagsField ? true :
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

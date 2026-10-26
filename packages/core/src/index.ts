/**
 * @micacms/core — the content model and the content format. Semver covers
 * everything that this entry point exports, and nothing else: Mica's own
 * packages use `@micacms/core/internal`, which can change in any release.
 *
 * Framework-independent: nothing here imports Astro, Vue, Hono, an auth
 * implementation, a provider SDK or a storage driver, or touches a filesystem
 * or a network. The boundary test enforces this. `fileSystemSource` is in
 * `@micacms/core/node`, because this entry point is bundled into the editor.
 */

/* The model: field builders, collections, singletons, the site, and the types they infer. */
export type * from "./types.js";
export {
  boolean,
  color,
  coordinates,
  date,
  email,
  media,
  number,
  object,
  relation,
  repeater,
  richText,
  select,
  id,
  tags,
  text,
  textarea,
  url,
  type BooleanOptions,
  type ColorOptions,
  type CommonOptions,
  type CoordinatesOptions,
  type DateOptions,
  type EmailOptions,
  type MediaOptions,
  type NumberOptions,
  type ObjectOptions,
  type RelationOptions,
  type RepeaterOptions,
  type RichTextOptions,
  type SelectOptions,
  type IdOptions,
  type TagsOptions,
  type TextareaOptions,
  type TextOptions,
  type UrlOptions,
} from "./fields.js";
export { collection, defineSite, ModelError, referenceSet, singleton, type SortableBy } from "./define.js";

/* Validation. */
export { fieldsSchema, validateFields, type FieldIssue, type SchemaOptions, type ValidationResult } from "./validation.js";
export { isValidId, toId } from "./to-id.js";

/* The content format: docs/content-format.md. */
export {
  documentName,
  documentPath,
  DOCUMENT_EXTENSION,
  entryDataPath,
  entryFiles,
  entryFolder,
  FormatError,
  INDEX_FILE,
  MEDIA_DIR,
  type PathSegment,
} from "./layout.js";
export { serializeEntry, type SerializedEntry } from "./serialize.js";
export { parseEntry, type EntryFiles } from "./parse.js";
export { ROW_KEY } from "./row-key.js";

/* Reading content. */
export {
  contentPath,
  ContentPathError,
  ContentSourceError,
  memorySource,
  type ContentSource,
  type DirectoryEntry,
} from "./source.js";
export {
  collectionIds,
  ContentReadError,
  ORDER_FILE,
  readCollection,
  readCollectionEntry,
  readOrder,
  readSingleton,
  type ContentEntry,
} from "./read.js";

/* The model file, `.mica/schema.json`. */
export { createManifest, MANIFEST_PATH, PROTOCOL_VERSION, type ProtocolManifest } from "./protocol.js";
export { ManifestError, readManifest, type ReadManifest } from "./manifest.js";

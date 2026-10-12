/**
 * @micacms/connectors — repository access for Mica.
 *
 * One interface, and the implementations of it. The Mica server holds no
 * content of its own; it reads and writes through whichever connector a site
 * is configured with.
 */

// The port and its value types live in @micacms/core now — connectors
// implement it, they do not define it. Re-exported here so existing imports
// keep working through the rename.
export {
  ConflictError,
  ConnectorError,
  type Author,
  type Change,
  type CommitInput,
  type CommitResult,
  type RepositoryConnector,
} from "@micacms/core";

export { localConnector, type LocalConnectorOptions } from "./local.js";

export {
  createContentStore,
  ContentError,
  ValidationError,
  type ContentStore,
  type SavedEntry,
  type SaveEntryInput,
} from "./store.js";

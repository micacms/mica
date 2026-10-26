/**
 * @micacms/runtime: the single-site, authentication-neutral Mica runtime.
 * It must never import an auth implementation; the composing app supplies the `AuthSurface`.
 */

export { createApp, allowAll, type AuthSurface, type CreateAppOptions } from "./app.js";
export {
  createRuntimeContext,
  type CreateRuntimeContextOptions,
  type OperationalFact,
  type OperationalInfo,
  type RuntimeContext,
  type RuntimeHealth,
  type SiteContext,
} from "./context.js";
export {
  bool,
  ConfigError,
  deriveRuntime,
  describeConfigIssues,
  list,
  loadEnvFile,
  isLoopbackUrl,
  LOOPBACK,
  runtimeEnv,
  withoutBlanks,
  type RuntimeConfig,
  type RuntimeEnv,
} from "./config.js";
export { createAppServer, startServer, type BesideTheApp, type StartServerOptions } from "./server.js";
export { AGENT_SCOPES, clientIp, type AgentGrant, type Env } from "./http.js";
export {
  loadSchema,
  SchemaError,
  schemaFingerprint,
  schemaOrigin,
} from "./schema.js";
export {
  allowedOrigins,
  apiErrorOf,
  errorHandler,
  originGuard,
  rateLimit,
  securityHeaders,
} from "./middleware/index.js";
export {
  ApiError,
  conflict,
  forbidden,
  unauthenticated,
  type ApiErrorBody,
  type ErrorCode,
} from "./lib/errors.js";
export { createLogger, recentProblems, type Logger, type ProblemLine } from "./lib/logger.js";
export { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
export { randomToken } from "./lib/id.js";
export { DEFAULT_PORT } from "./lib/ports.js";
export { VERSION } from "./lib/version.js";
export {
  analyseChanges,
  describeProblems,
  flattenProblems,
  groupOf,
  type AnnotatedChange,
  type ChangeOwner,
  type CompareTarget,
  type Comparison,
  type ContentStagingService,
  type RepositoryInfo,
  type PublishInput,
  type StagingProblem,
  type StagingStatus,
  type StagingValidation,
} from "./services/changes.js";
export {
  createWorkingTreeStagingService,
  validateSelection,
  type SelectionCheck,
  type WorkingTreeStagingDeps,
} from "./services/staging.js";
export { formatBytes, type MediaFile, type MediaService } from "./services/media.js";
export { publishChanges } from "./services/publish.js";
export { MODEL_UNREADABLE, refuseWhileModelUnreadable } from "./services/model-guard.js";
export { storeUpload, type UploadInput } from "./services/upload.js";
export type { Referrer } from "./services/links.js";
export {
  createContentStore,
  ValidationError,
  type ContentStore,
  type SavedEntry,
  type SaveEntryInput,
} from "./services/content-store.js";
export {
  ConflictError,
  contentFiles,
  type Author,
  type ContentFiles,
  type ContentFilesOptions,
  type FileChange,
  type FileChanges,
  type FileStat,
} from "./workspace/files.js";
export {
  firstLine,
  GitError,
  gitRunner,
  type GitCallOptions,
  type GitRunner,
  type GitRunnerOptions,
} from "./workspace/git.js";
export {
  assignsLfsUnder,
  attributesPlace,
  lfsUnderRoot,
  lfsUnderRootInTree,
  pushLfsObjects,
} from "./workspace/lfs.js";
export {
  createMutex,
  createReadWriteLock,
  createWorkspaceLocks,
  lockedFiles,
  type Mutex,
  type ReadWriteLock,
  type WorkspaceLocks,
} from "./workspace/locks.js";
export type {
  OwnerPolicy,
  PublishAvailability,
  RepositoryDescription,
  SyncConflict,
  SyncStatus,
} from "./workspace/policy.js";
export {
  commitPaths,
  currentBranch,
  detachedHead,
  listTemporaries,
  listTreeChanges,
  locateTree,
  parseStatus,
  parseStatusEntries,
  recommitPaths,
  temporaryOf,
  unpushedCommits,
  type DetachedHead,
  type GitTree,
  type TreeChange,
  type UnpushedCommits,
} from "./workspace/tree.js";
export type {
  ChangesResponse,
  CompareManyResponse,
  EntryDetail,
  EntrySummary,
  MediaUsage,
  ModelState,
  Overview,
  PreviewState,
  PreviewStatus,
  Schema,
  SchemaCollection,
  SchemaReferenceSet,
  SchemaSingleton,
  SchemaSite,
  SingletonDetail,
  SystemInfo,
} from "./routes/responses.js";

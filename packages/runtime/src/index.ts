/**
 * @micacms/runtime: the single-site, authentication-neutral Mica runtime.
 * It must never import an auth implementation; the composing app supplies the `AuthSurface`.
 */

export { createApp, allowAll, type AuthSurface, type CreateAppOptions } from "./app.js";
export {
  createRuntimeContext,
  DEFAULT_SITE_ID,
  type CreateRuntimeContextOptions,
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
export { startServer, type StartServerOptions } from "./server.js";
export { actorOf, AGENT_SCOPES, clientIp, editorOf, type AgentGrant, type Env } from "./http.js";
export {
  loadSchema,
  SchemaError,
  schemaFingerprint,
  schemaOrigin,
} from "./schema.js";
export {
  allowedOrigins,
  errorHandler,
  originGuard,
  rateLimit,
  requestContext,
  securityHeaders,
} from "./middleware/index.js";
export { adminAssetsExist } from "./routes/admin-spa.js";
export {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthenticated,
  type ApiErrorBody,
  type ErrorCode,
} from "./lib/errors.js";
export { createLogger, type Logger } from "./lib/logger.js";
export { createRateLimiter, type RateLimiter } from "./lib/rate-limit.js";
export { randomToken } from "./lib/id.js";
export { DEFAULT_BASE_URL, DEFAULT_PORT } from "./lib/ports.js";
export { VERSION } from "./lib/version.js";
export {
  analyseChanges,
  classifyPath,
  describeProblems,
  flattenProblems,
  type AnnotatedChange,
  type ChangeOwner,
  type ContentStagingService,
  type RepositoryInfo,
  type PublishInput,
  type StagingProblem,
  type StagingStatus,
  type StagingValidation,
} from "./services/changes.js";
export {
  createWorkingTreeStagingService,
  type WorkingTreeStagingDeps,
} from "./services/staging.js";
export { createMediaService, formatBytes, type MediaFile, type MediaService } from "./services/media.js";
export { publishChanges } from "./services/publish.js";
export { storeUpload, type UploadInput } from "./services/upload.js";
export {
  createContentStore,
  ContentError,
  ValidationError,
  type ContentStore,
  type SavedEntry,
  type SaveEntryInput,
} from "./services/content-store.js";
export {
  checkChangePaths,
  ConflictError,
  contentFiles,
  FilesError,
  type Author,
  type ContentFiles,
  type ContentFilesOptions,
  type FileChange,
  type FileChanges,
  type FileStat,
} from "./workspace/files.js";
export {
  developerEnvironment,
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
export { developerPolicy, type DeveloperPolicyOptions } from "./workspace/developer.js";
export {
  commitPaths,
  detachedHead,
  headRevision,
  headSource,
  inRepo,
  listTreeChanges,
  LITERAL,
  locateTree,
  parseStatus,
  recommitPaths,
  type DetachedHead,
  type GitTree,
  type TreeChange,
} from "./workspace/tree.js";
export { schemaStats } from "./lib/schema-stats.js";

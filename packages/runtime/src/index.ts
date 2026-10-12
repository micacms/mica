/**
 * @micacms/runtime — the single-site Mica runtime, authentication-neutral.
 *
 * One Hono API over one `SiteContext`: content, media, staging and system
 * routes, with the question "who is this request?" answered by whatever
 * `AuthSurface` the composing app hands in. `@micacms/editor` composes it
 * with no authentication at all behind a loopback bind; `@micacms/self-hosted`
 * composes it behind `@micacms/auth-oidc`. This package must never import an
 * auth implementation — that direction is what protects the local
 * distribution.
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
  LOOPBACK,
  runtimeEnv,
  withoutBlanks,
  type RuntimeConfig,
  type RuntimeEnv,
} from "./config.js";
export { startServer, type StartServerOptions } from "./server.js";
export { actorOf, clientIp, intParam, type Env } from "./http.js";
export { checkSchema, loadSchema, SchemaError, schemaFingerprint, schemaOrigin } from "./schema.js";
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
  validationFailed,
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
  type PublishInput,
  type StagingProblem,
  type StagingStatus,
  type StagingValidation,
} from "./services/changes.js";
export {
  createWorkingTreeStagingService,
  type WorkingTreeStagingDeps,
} from "./services/staging-local.js";
export { createMediaService, formatBytes, type MediaFile, type MediaService } from "./services/media.js";
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
  createMutex,
  createReadWriteLock,
  createWorkspaceLocks,
  lockedConnector,
  type Mutex,
  type ReadWriteLock,
  type WorkspaceLocks,
} from "./workspace/locks.js";
export type { OwnerPolicy, PublishAvailability } from "./workspace/policy.js";
export { developerPolicy, type DeveloperPolicyOptions } from "./workspace/developer.js";
export {
  commitPaths,
  headRevision,
  headSource,
  inRepo,
  listTreeChanges,
  LITERAL,
  locateTree,
  parseStatus,
  recommitPaths,
  type GitTree,
  type TreeChange,
} from "./workspace/tree.js";
export { schemaStats } from "./lib/schema-stats.js";

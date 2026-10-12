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
  createConnector,
  createRuntimeContext,
  DEFAULT_SITE_ID,
  type CreateRuntimeContextOptions,
  type OperationalInfo,
  type RuntimeContext,
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
  requireRepositoryConfig,
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
export { openSqlite, type RunResult, type SqlDatabase, type SqlParams, type SqlValue } from "./db/driver.js";
export { createDraftStagingService, type DraftStagingDeps } from "./services/staging.js";
export {
  analyseChanges,
  classifyPath,
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
export { schemaStats } from "./lib/schema-stats.js";

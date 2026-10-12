/**
 * The local editor's configuration.
 *
 * Small on purpose: the variables the runtime reads, minus everything that
 * describes a deployment. There is no `REPOSITORY` — this app always edits
 * the developer's checkout — no `MICA_DATA_DIR`, because it keeps no state,
 * and no OIDC or admission variable exists to be set, which is a stronger
 * statement than ignoring one.
 *
 * The refusals are the containment for a server with no authentication:
 * production is refused, a non-local public URL is refused, and any listening
 * address but loopback is refused, with no override. Remote access is what
 * the self-hosted distribution is.
 */

import { z } from "zod";

import {
  bool,
  ConfigError,
  deriveRuntime,
  describeConfigIssues,
  loadEnvFile,
  LOOPBACK,
  runtimeEnv,
  withoutBlanks,
  type RuntimeConfig,
} from "@micacms/runtime";

const {
  NODE_ENV,
  LOG_LEVEL,
  HOST,
  PORT,
  MICA_PUBLIC_URL,
  CONTENT_ROOT,
  MICA_LOCAL_PUBLISH,
  MAX_UPLOAD_BYTES,
  ADMIN_ORIGINS,
  ADMIN_DIR,
} = runtimeEnv;

const schema = z
  .object({
    NODE_ENV,
    LOG_LEVEL,
    HOST,
    PORT,
    MICA_PUBLIC_URL,
    CONTENT_ROOT,
    MICA_LOCAL_PUBLISH,
    MAX_UPLOAD_BYTES,
    ADMIN_ORIGINS,
    ADMIN_DIR,

    /**
     * Set by the `mica` bin, and by nothing else. The audience for the
     * startup output: a person at a terminal gets one banner, a log collector
     * gets the structured lines.
     */
    MICA_CLI: bool(false),
    /** Whether that front door should open a browser once it is listening. */
    MICA_OPEN: bool(false),
  })
  .transform((env) => ({
    ...deriveRuntime({
      ...env,
      // Fixed, not configurable: the local editor edits a checkout. A remote
      // repository is the self-hosted app's job.
      REPOSITORY: "local" as const,
      // There is no proxy in front of a loopback server to trust.
      TRUST_PROXY: false,
    }),
    HOST: env.HOST ?? "127.0.0.1",
  }));

export type LocalConfig = RuntimeConfig & { MICA_CLI: boolean; MICA_OPEN: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LocalConfig {
  // Only when reading the ambient environment: tests pass an explicit object
  // and must not pick up whatever `.env` sits in the working directory.
  if (env === process.env) loadEnvFile();

  const parsed = schema.safeParse(withoutBlanks(env));
  if (!parsed.success) throw new ConfigError(describeConfigIssues(parsed.error));

  const config = parsed.data;

  /**
   * The local editor has no authentication. It must never be reachable.
   *
   * This is the single most dangerous configuration Mica can be in, so it is
   * refused at the three points where it stops being a developer's
   * convenience: a production build, a base URL that is not the local
   * machine, and a listening address that is not the local machine either.
   */
  if (config.isProduction) {
    throw new ConfigError(
      "The local editor has no authentication, and NODE_ENV=production.\n" +
        "  There is no identity provider and no user: every request is allowed.\n" +
        "  A deployment runs @micacms/self-hosted with an OIDC provider instead —\n" +
        "  see docs/self-hosting.md.",
    );
  }

  const host = new URL(config.MICA_PUBLIC_URL).hostname;
  if (!LOOPBACK.has(host)) {
    throw new ConfigError(
      `The local editor has no authentication, but MICA_PUBLIC_URL points at "${host}".\n` +
        "  It is for a developer's own machine only. Anything reachable by anyone\n" +
        "  else runs @micacms/self-hosted with an identity provider.",
    );
  }

  /**
   * The same rule for the socket. A base URL saying `localhost` while the
   * process listens on `0.0.0.0` leaves an unauthenticated editor open to the
   * whole network. There is deliberately no override.
   */
  if (!LOOPBACK.has(config.HOST) && config.HOST !== "::1") {
    throw new ConfigError(
      `The local editor has no authentication, but HOST is "${config.HOST}".\n` +
        "  It binds to the loopback address and nothing else. Use HOST=127.0.0.1,\n" +
        "  or run @micacms/self-hosted with an identity provider.",
    );
  }

  return config;
}

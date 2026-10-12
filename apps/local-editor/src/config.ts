/**
 * The local editor's configuration: the runtime variables minus everything that
 * describes a deployment. The server has no authentication, so it refuses
 * production and any non-loopback URL or address, with no override.
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
     * Set only by the `mica` bin: a terminal gets one banner, a log collector
     * gets structured lines.
     */
    MICA_CLI: bool(false),
    /** Whether that front door should open a browser once it is listening. */
    MICA_OPEN: bool(false),
  })
  .transform((env) => ({
    ...deriveRuntime({
      ...env,
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

  // The local editor has no authentication, so it must never be reachable from another machine.
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

  // A `localhost` URL with a socket on `0.0.0.0` opens the editor to the whole
  // network. No override, on purpose.
  if (!LOOPBACK.has(config.HOST)) {
    throw new ConfigError(
      `The local editor has no authentication, but HOST is "${config.HOST}".\n` +
        "  It binds to the loopback address and nothing else. Use HOST=127.0.0.1,\n" +
        "  or run @micacms/self-hosted with an identity provider.",
    );
  }

  return config;
}

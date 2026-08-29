/**
 * The self-hosted deployment's configuration: the runtime fragment plus the
 * auth fragment plus the two things only this composition has — a data
 * directory and the database inside it.
 *
 * The refusals live where the fragments do — `requireAuthConfig` for OIDC and
 * admission, `requireRepositoryConfig` for a provider repository — and this
 * file adds the one that is the deployment's own: secrets are mandatory in
 * production, ephemeral in development.
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";

import { authEnv, deriveAuth, requireAuthConfig, type AuthConfig } from "@micacms/auth-oidc";
import {
  ConfigError,
  deriveRuntime,
  describeConfigIssues,
  loadEnvFile,
  requireRepositoryConfig,
  runtimeEnv,
  withoutBlanks,
  type RuntimeConfig,
} from "@micacms/runtime";

const schema = z
  .object({
    ...runtimeEnv,
    ...authEnv,

    /** Operational state: the database holding sessions and the draft store. */
    DATA_DIR: z.string().default("./data"),
    DATABASE_PATH: z.string().optional(),
  })
  .transform((env) => {
    const dataDir = path.resolve(env.DATA_DIR);
    return {
      ...deriveAuth(deriveRuntime(env)),
      // A container has to bind every interface to be reachable at all.
      HOST: env.HOST ?? "0.0.0.0",
      dataDir,
      databasePath: path.resolve(env.DATABASE_PATH ?? path.join(dataDir, "cms.sqlite")),
    };
  });

export type SelfHostedConfig = RuntimeConfig &
  AuthConfig & {
    dataDir: string;
    databasePath: string;
    SESSION_SECRET?: string | undefined;
    /** Names of the secrets this process generated for itself. */
    devSecrets: string[];
  };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SelfHostedConfig {
  // Only when reading the ambient environment: tests pass an explicit object
  // and must not pick up whatever `.env` sits in the working directory.
  if (env === process.env) loadEnvFile();

  const parsed = schema.safeParse(withoutBlanks(env));
  if (!parsed.success) throw new ConfigError(describeConfigIssues(parsed.error));

  const config = parsed.data;

  requireAuthConfig(config);
  requireRepositoryConfig({ ...config, HOST: config.HOST });

  // Secrets are mandatory in production. In development an ephemeral one is
  // generated so a trial run works from a clean checkout — at the cost of
  // signing everyone out on restart, which is the correct trade-off there.
  const missing: string[] = [];
  if (!config.SESSION_SECRET) missing.push("SESSION_SECRET");

  if (config.isProduction && missing.length > 0) {
    throw new ConfigError(
      `Missing required production secrets: ${missing.join(", ")}.\n` +
        `Generate them with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  return {
    ...config,
    sessionSecret: config.SESSION_SECRET ?? randomBytes(32).toString("hex"),
    devSecrets: missing,
  };
}

/**
 * Grants somebody access to a site, from the command line.
 *
 *   pnpm --filter @micacms/editor grant-access -- --email a@b.ch --role admin
 *
 * This is the bootstrap: an empty deployment has no members, so nobody can be
 * invited through the admin, because inviting requires being an administrator.
 * One shell command breaks that circle. (`OIDC_BOOTSTRAP_ADMIN` does the same
 * thing declaratively, for deployments that would rather not run a command.)
 *
 * It sets no password, because Mica has none. It records that the holder of an
 * email address may edit here; the identity provider decides whether somebody
 * is that person. Running it for someone who has never signed in is exactly
 * right — the account becomes real when they do.
 */

import { loadConfig } from "../config.js";
import { openDatabase } from "../db/index.js";
import { createLogger } from "../lib/logger.js";
import { createMembershipRepository, type Role } from "../repositories/memberships.js";
import { createSiteRepository, DEFAULT_SITE_ID } from "../repositories/sites.js";
import { createUserRepository } from "../repositories/users.js";

interface Args {
  email?: string;
  name?: string;
  role?: string;
  site?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) continue;

    const key = flag.slice(2);
    const value = argv[i + 1]?.startsWith("--") ? undefined : argv[++i];

    if (value && (key === "email" || key === "name" || key === "role" || key === "site")) {
      args[key] = value;
    }
  }

  return args;
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email) {
    fail(
      "Usage: grant-access --email <address> [--role admin|editor] [--name <name>] [--site <id>]\n\n" +
        "  Records that this person may edit the site. They sign in through the\n" +
        "  identity provider; Mica never sees a password.",
    );
  }

  const role = (args.role ?? "admin") as Role;
  if (role !== "admin" && role !== "editor") fail(`Unknown role "${args.role}".`);

  const config = loadConfig();
  const logger = createLogger({ level: "warn", pretty: true });
  const db = openDatabase(config.databasePath, { logger });

  try {
    const users = createUserRepository(db);
    const memberships = createMembershipRepository(db);
    const sites = createSiteRepository(db);

    const siteId = args.site ?? DEFAULT_SITE_ID;
    const site = sites.findById(siteId);
    if (!site) fail(`There is no site "${siteId}".`);

    const existing = users.findByEmail(args.email);
    const user = existing ?? users.create({ email: args.email, name: args.name ?? "" });

    if (args.name && existing) users.update(user.id, { name: args.name });

    const had = memberships.find(siteId, user.id);
    memberships.grant({ siteId, userId: user.id, role });

    const verb = had ? (had.role === role ? "already had" : "changed to") : "granted";
    console.log(`\n${user.email} ${verb} ${role} on "${site.name}".`);

    if (config.authDisabled) {
      console.log(
        "\nNote: MICA_MODE=local, so authentication is disabled and this grant\n" +
          "      makes no difference locally — every request is the developer account.",
      );
    } else if (!existing) {
      console.log(
        `\nThey become active when they first sign in at ${config.CMS_BASE_URL}/admin/\n` +
          "and the identity provider confirms they hold that address.",
      );
    }

    console.log();
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

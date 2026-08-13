/**
 * Creates or updates a CMS account.
 *
 *   pnpm --filter @micacms/cms create-user
 *   pnpm --filter @micacms/cms create-user -- --email a@b.ch --role admin
 *
 * With no arguments it prompts. `--password` is accepted for provisioning
 * scripts, but the prompt is preferred: a password passed on the command line
 * lands in the shell history and in `ps` output.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { loadConfig } from "../config.js";
import { openDatabase } from "../db/index.js";
import { createLogger } from "../lib/logger.js";
import { createUserRepository, type UserRole } from "../repositories/users.js";
import { checkPasswordStrength, hashPassword } from "../services/password.js";

interface Args {
  email?: string;
  name?: string;
  role?: string;
  password?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) continue;
    const key = flag.slice(2);
    const value = argv[i + 1]?.startsWith("--") ? undefined : argv[++i];
    if (value && (key === "email" || key === "name" || key === "role" || key === "password")) {
      args[key] = value;
    }
  }
  return args;
}

/** Reads a line without echoing it, so the password is not left on screen. */
async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const output = stdout as unknown as { write(chunk: string): boolean };

  const onKeypress = (): void => {};
  const originalWrite = output.write.bind(output);
  let muted = false;

  output.write = (chunk: string): boolean => {
    if (muted && !chunk.includes("\n")) return true;
    return originalWrite(chunk);
  };

  try {
    const promise = rl.question(question);
    muted = true;
    const answer = await promise;
    muted = false;
    originalWrite("\n");
    return answer;
  } finally {
    output.write = originalWrite;
    rl.off("keypress", onKeypress);
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const logger = createLogger({ level: "warn", pretty: true });
  const db = openDatabase(config.databasePath, { logger });
  const users = createUserRepository(db);

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const email = args.email ?? (await rl.question("Email: "));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      throw new Error(`"${email}" is not a valid email address.`);
    }

    const existing = users.findByEmail(email);
    const name = args.name ?? (await rl.question(`Name${existing ? ` [${existing.name}]` : ""}: `));

    // The first account must be able to manage users, so it is always an admin.
    const isFirst = users.count() === 0;
    const roleInput =
      args.role ??
      (isFirst ? "admin" : ((await rl.question("Role (admin/editor) [editor]: ")) || "editor"));

    if (roleInput !== "admin" && roleInput !== "editor") {
      throw new Error(`Role must be "admin" or "editor", got "${roleInput}".`);
    }
    const role = roleInput as UserRole;

    let password = args.password;
    if (!password) {
      password = await promptHidden("Password: ");
      const confirm = await promptHidden("Confirm password: ");
      if (password !== confirm) throw new Error("The passwords do not match.");
    }

    const problem = checkPasswordStrength(password);
    if (problem) throw new Error(problem);

    const passwordHash = await hashPassword(password);

    if (existing) {
      users.update(existing.id, {
        name: name || existing.name,
        role,
        passwordHash,
        mustChangePassword: false,
      });
      stdout.write(`\nUpdated ${email} (${role}).\n`);
    } else {
      const user = users.create({
        email,
        name: name || email.split("@")[0]!,
        role,
        passwordHash,
        mustChangePassword: false,
      });
      stdout.write(`\nCreated ${user.email} (${user.role}).\n`);
      if (isFirst) {
        stdout.write(`Sign in at ${config.CMS_BASE_URL}/admin/\n`);
      }
    }
  } finally {
    rl.close();
    db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

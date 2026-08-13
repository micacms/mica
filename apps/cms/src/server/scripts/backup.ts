/**
 * Creates a consistent backup of the whole CMS state.
 *
 *   pnpm --filter @micacms/cms backup -- --out /backups
 *
 * A complete backup is the database plus the media directory, and nothing else.
 * The database is copied with `VACUUM INTO`, which takes a read lock only — so
 * this is safe to run against a live server from cron, and does not produce the
 * torn file that a plain `cp` of a WAL-mode database can.
 *
 * See `docs/backup-and-restore.md` for the restore procedure.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../config.js";
import { openSqlite } from "../db/driver.js";

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function directorySize(directory: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  try {
    for (const name of await fs.readdir(directory)) {
      const stat = await fs.stat(path.join(directory, name));
      if (stat.isFile()) {
        files++;
        bytes += stat.size;
      }
    }
  } catch {
    // A media directory that does not exist yet is an empty one.
  }
  return { files, bytes };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf("--out");
  const outRoot = path.resolve(outIndex >= 0 ? (argv[outIndex + 1] ?? "./backups") : "./backups");

  const config = loadConfig();
  const target = path.join(outRoot, `mica-${timestamp()}`);

  await fs.mkdir(target, { recursive: true });

  // Open read-only-ish: no migrations, no WAL switch, just the snapshot.
  const db = openSqlite(config.databasePath, { wal: false });
  try {
    db.snapshot(path.join(target, "cms.sqlite"));
  } finally {
    db.close();
  }

  await fs.cp(config.mediaDir, path.join(target, "media"), {
    recursive: true,
    force: true,
    errorOnExist: false,
  }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(path.join(target, "media"), { recursive: true });
  });

  const dbStat = await fs.stat(path.join(target, "cms.sqlite"));
  const media = await directorySize(path.join(target, "media"));

  await fs.writeFile(
    path.join(target, "manifest.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        source: { database: config.databasePath, media: config.mediaDir },
        database: { bytes: dbStat.size },
        media,
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(
    `Backup written to ${target}\n` +
      `  database  ${(dbStat.size / 1024 / 1024).toFixed(1)} MB\n` +
      `  media     ${media.files} files, ${(media.bytes / 1024 / 1024).toFixed(1)} MB\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`Backup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

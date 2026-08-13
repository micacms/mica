# Backup and restore

A complete backup of a Mica deployment is two things:

```
cms.sqlite        the database — content, revisions, users, media metadata
media/            the uploaded files themselves
```

That is the whole surface. There is no second database, no cache to warm, no
external service holding state.

---

## Taking a backup

```bash
docker compose exec cms node dist/server/scripts/backup.js --out /data/backups
```

Or, running from source:

```bash
pnpm --filter @micacms/cms backup -- --out ./backups
```

This produces a timestamped directory:

```
backups/mica-2026-08-11T13-04-11/
├── cms.sqlite
├── media/
└── manifest.json     # sizes and source paths, for verification
```

### Why not just copy the file

The database runs in WAL mode, so at any instant the committed state is split
between `cms.sqlite` and `cms.sqlite-wal`. A plain `cp` of the first file alone
can capture a torn, unrecoverable snapshot.

The script uses SQLite's `VACUUM INTO`, which:

- takes a **read lock only** — editors keep working while it runs;
- writes a **single consistent, defragmented file** with the WAL already
  folded in;
- needs no downtime, no maintenance window, and no `docker compose stop`.

Run it from cron against a live server without a second thought.

---

## Automating it

The compose file ships a `backup` profile that runs the script daily into
`./backups` on the host:

```bash
docker compose --profile backup up -d
```

Host cron, if you prefer:

```cron
30 3 * * * cd /srv/mica && docker compose exec -T cms \
  node dist/server/scripts/backup.js --out /data/backups
```

### Get it off the machine

A backup on the same disk as the original protects against a bad edit, not
against losing the server. Sync it somewhere else — the tool does not matter and
is deliberately not prescribed:

```bash
# restic, to any S3-compatible bucket, encrypted
restic -r s3:s3.example.com/mica-backups backup /srv/mica/backups

# rclone, to whatever the customer already pays for
rclone sync /srv/mica/backups remote:mica-backups

# rsync, to a second machine
rsync -az --delete /srv/mica/backups/ backup-host:/backups/mica/
```

### Retention

A reasonable default for an SME: 7 daily, 4 weekly, 6 monthly. Prune old
directories however your sync tool prefers; nothing in the CMS depends on them.

---

## Restoring

Restoring is a file copy. There is no import step and nothing to replay.

```bash
# 1. Stop the CMS so nothing writes during the swap.
docker compose stop cms

# 2. Put the files back.
docker run --rm \
  -v mica_cms-data:/data \
  -v /srv/mica/backups/mica-2026-08-11T13-04-11:/restore:ro \
  alpine sh -c '
    rm -f /data/cms.sqlite /data/cms.sqlite-wal /data/cms.sqlite-shm
    cp /restore/cms.sqlite /data/cms.sqlite
    rm -rf /data/media && cp -r /restore/media /data/media
    chown -R 1000:1000 /data
  '

# 3. Start it again. Migrations run automatically if the backup is older
#    than the current build.
docker compose start cms

# 4. Confirm.
curl -fsS https://cms.example.com/health
```

Deleting the stale `-wal` and `-shm` files in step 2 matters: leaving them beside
a restored database would let SQLite replay transactions that belong to the
snapshot you just discarded.

### Then rebuild the website

The static site still reflects the content as of its last build. Trigger a
rebuild from the CMS dashboard ("Rebuild website"), or from CI.

---

## Practise it

An untested backup is a hope, not a plan. Once, before going live, and once a
year after:

```bash
# Restore into a throwaway stack and check the content is really there.
docker compose -p mica-drill up -d
# …restore into mica-drill_cms-data, sign in, open a few entries…
docker compose -p mica-drill down -v
```

The whole exercise takes ten minutes. Knowing it works is the reason the rest of
this architecture is worth its simplicity.

---

## What is *not* backed up

- **Sessions.** Restoring signs everyone out. Intended.
- **Rate-limit counters.** In memory, reset on restart. Intended.
- **The static website.** It is a build artefact; rebuild it from the CMS.
- **`.env`.** Store `SESSION_SECRET` and `CMS_READ_TOKEN` in your password
  manager. A database restored without its `SESSION_SECRET` still works — every
  editor simply signs in again.

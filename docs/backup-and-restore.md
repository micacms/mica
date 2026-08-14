# Backup and restore

Most of this document used to describe how to back up a website. It no longer
needs to, and that is the point of the Git-native architecture: the thing worth
protecting is already protected by something better than a cron job.

A Mica deployment holds two separate things, and they deserve very different
treatment.

| | What it is | What losing it costs |
| --- | --- | --- |
| The content repository | Every entry, every uploaded file, every revision | The website |
| `cms.sqlite` | Accounts and sessions | Everyone signs in again |

---

## The content repository

**Git is the backup.** Every save is a commit, so the history is complete by
construction rather than by schedule, and any clone is a full copy.

If it is hosted on GitHub or GitLab, that is already off-site and replicated. If
you want a copy under your own control as well, mirror it:

```bash
git clone --mirror git@github.com:acme/website.git
# and, on a schedule:
git --git-dir=website.git remote update --prune
```

Restoring is a clone. There is nothing to import, no schema to match, and no
version of Mica that has to be running for the files to be readable — an entry
is a JSON file with Markdoc beside it, and a text editor will do.

This is worth stating plainly because it is the property everything else was
designed around: **you can delete Mica entirely and still have your website.**

### What a recovery actually looks like

```bash
git clone git@github.com:acme/website.git
cd website && pnpm install && pnpm build
```

The Astro build reads the repository directly. It does not need the CMS to be
running, reachable, or even installed.

---

## Mica's database

`cms.sqlite` holds user accounts, password hashes and active sessions. It holds
no content.

Backing it up is optional. Decide by asking what you would rather do after
losing the volume: restore a file, or run `create-user` once and tell three
editors to sign in again. For most deployments the second is less work than
maintaining the first.

If you do want a copy, SQLite makes a consistent one under load:

```bash
docker compose exec cms \
  node -e "require('node:sqlite') && 0" # (Node 22+; the CLI below is simpler)

sqlite3 /var/lib/docker/volumes/mica_cms-data/_data/cms.sqlite \
  ".backup '/backups/cms-$(date +%F).sqlite'"
```

`.backup` and `VACUUM INTO` both take a read lock only, so editors are never
blocked. Copying the file with `cp` while the server runs is **not** safe: WAL
mode means recent commits live in `cms.sqlite-wal`, and a plain copy misses them.

Restoring is stopping the container, putting the file back, and starting it.

---

## What is no longer here

Earlier versions of Mica shipped a `backup` script and a scheduled backup
service in `docker-compose.yml`, because the database *was* the website. Both
are gone. Keeping them would imply that a Mica backup protects your content,
and it would not be the thing you reached for if you ever needed it.

---

## Verifying a backup

A backup nobody has restored is a hypothesis. For the repository:

```bash
git clone /path/to/mirror.git restore-test
cd restore-test && pnpm install && pnpm build
```

If the site builds, the content is intact — the build reads every entry and
validates it against the model, so a corrupted or truncated file fails loudly
rather than producing a quietly empty page.

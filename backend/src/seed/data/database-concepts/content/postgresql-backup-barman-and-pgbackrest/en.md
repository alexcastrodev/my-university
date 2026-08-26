---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`pg_basebackup` can produce a single backup, but a real backup *strategy* needs more: an inventory of every backup taken, WAL archived continuously for point-in-time recovery (PITR), a retention policy that expires old backups automatically, and the ability to restore to a different server entirely. Barman and pgBackRest both solve this, from two different angles — Barman manages a fleet of PostgreSQL clusters from one dedicated backup server via SSH and streaming replication, while pgBackRest is a self-contained tool built for speed and works equally well backing up a single local instance or (with more setup) a dedicated repository host. `pg_dump` is not a backup tool for either of these use cases — it's a logical export, useful for partial extracts, not a way to protect a whole cluster.

## Use Cases

- Managing backups for an entire fleet of PostgreSQL clusters (production, DR, staging) from one centralized server, with per-cluster retention policies and a searchable catalog of every backup ever taken.
- Achieving near-zero data loss (RPO ≈ 0) by having the backup tool participate in the replication stream itself, rather than relying solely on periodic `archive_command` WAL shipping.
- Cloning a production database onto a new server for testing or disaster recovery, without touching the primary beyond a normal backup.
- Running fast, compressed, incremental backups on a single high-throughput server where a dedicated backup-management host isn't justified.

## Deep Dive

### Barman: a dedicated backup server that reaches into PostgreSQL over SSH

Barman runs on its own server and pulls files from the PostgreSQL primary via SSH — no agent needs to run on the database server itself beyond normal SSH access:

```bash
# on pg-backup, as the barman user
ssh-keygen -t rsa -N ''
ssh-copy-id postgres@pg-primary
```

```sql
-- on pg-primary
CREATE USER barman WITH REPLICATION SUPERUSER PASSWORD 'mypasshere';
```

```
# pg_hba.conf on pg-primary
host    all             barman      pg-backup   md5
host    replication     barman      pg-backup   md5
```

```ini
# /etc/barman.d/pg-primary.conf on pg-backup
[pg-primary]
description = "Primary PostgreSQL Server"
conninfo = "host=pg-primary user=barman dbname=postgres"
streaming_conninfo = "host=pg-primary user=barman"
ssh_command = "ssh postgres@pg-primary"
backup_method = rsync
archiver = off
streaming_archiver = on
slot_name = barman
```

`backup_method = rsync` uses filesystem hard links between backups, which is what makes Barman's backups effectively incremental without any special incremental-backup logic — unchanged files are linked, not recopied. `streaming_archiver = on` (with `archiver = off`) tells Barman to pull WAL over the replication protocol instead of waiting for `archive_command` to push files — a replication slot (`slot_name = barman`) keeps the primary from recycling WAL Barman hasn't fetched yet, exactly the same mechanism a physical standby relies on.

```bash
# bootstrap the WAL stream, then verify
barman receive-wal pg-primary --create-slot
barman cron
barman switch-wal pg-primary --force
barman check pg-primary
```

### Taking and inspecting a Barman backup

```bash
barman backup pg-primary
barman list-backup pg-primary
barman show-backup pg-primary latest
barman list-files pg-primary latest
```

`latest` is a standing shortcut that always resolves to the most recent backup ID, so scripts don't need to track IDs manually. A retention policy expires old backups and WAL automatically instead of requiring manual cleanup:

```ini
retention_policy = RECOVERY WINDOW OF 1 WEEK
```

### Restoring with Barman — including to a different server

```bash
# on pg-backup, as barman — restores remotely to pg-clone over SSH
barman recover \
  --remote-ssh-command "ssh postgres@pg-clone" \
  pg-primary latest /db/pgdata
```

Barman restores can target any server it can reach via SSH, not just the original primary — this is what makes cloning a production database for testing or DR straightforward. Barman deliberately disables `archive_command` on a freshly restored server (to avoid the clone polluting the original WAL archive with its own files) — turning a restored copy into a genuine standby requires manually setting `primary_conninfo`, which the `--standby-mode` flag can pre-wire.

### pgBackRest: a self-contained tool with built-in compression and parallelism

```ini
# /etc/pgbackrest.conf on pg-primary
[main]
pg1-path=/db/pgdata
[global]
repo1-path=/var/lib/pgbackrest
repo1-retention-full=1
start-fast=y
```

```ini
# postgresql.conf
archive_command = 'pgbackrest --stanza=main archive-push %p'
```

```bash
pgbackrest --stanza=main --log-level-console=info stanza-create
pgbackrest --stanza=main --log-level-console=info check
pgbackrest info
```

The `pg1-path`/`repo1-*` numbering exists because pgBackRest can manage multiple PostgreSQL instances and multiple backup repositories from one configuration — indexing them rather than assuming exactly one of each. `start-fast` forces an immediate checkpoint rather than waiting for the next scheduled one, trading a brief I/O spike for a backup that starts sooner.

### Backing up with pgBackRest — full, incremental, differential

```bash
pgbackrest --stanza=main --type=full backup
pgbackrest --stanza=main info
pgbackrest ls backup/main/latest --recurse
```

Three backup types, each a different trade-off: `full` copies everything with no dependency on prior backups; `incr` stores only what changed since the *last successful backup* (full or incremental); `diff` stores what changed since the *last full backup* specifically. Where Barman's rsync-based approach always produces a backup with a complete file listing (via hard links to unchanged files), pgBackRest's incremental/differential backups genuinely skip unchanged files on disk — smaller, but every incremental in the chain becomes dependent on the full backup it's based on. Removing that full backup invalidates every incremental built on it, which is why pgBackRest recommends taking a fresh full backup on a regular cadence (e.g., weekly) rather than letting an incremental chain grow indefinitely.

## Trade-offs

- **Barman's centralized-fleet model and pgBackRest's self-contained model solve different problems.** Barman is built around managing many clusters from one backup server via SSH/streaming; pgBackRest works great locally on a single instance and can be extended to a dedicated repository host, but that setup is a separate client-server configuration effort documented as its own topic ("Dedicated Backup Host"), not the default shape. Picking between them is really picking which topology matches the number of clusters actually being managed.
- **pgBackRest's incremental backups have a hard dependency chain; Barman's don't.** Deleting the full backup underneath a pgBackRest incremental chain invalidates every incremental built on it; Barman's hard-link approach means every backup, incremental in spirit or not, is independently a complete file listing. This changes how aggressively old full backups can be pruned in each tool.
```bash
# pgBackRest: this full backup can NOT be safely deleted if incrementals depend on it
pgbackrest --stanza=main --type=full backup
```
- **Barman's near-zero-RPO capability (streaming WAL directly into the backup catalog, with synchronous replication support) is a genuinely distinguishing feature** — most backup tools only archive WAL periodically via `archive_command`, leaving a window of potential data loss between archive cycles; Barman receiving WAL as a streaming replica closes that window to nearly nothing, at the cost of running Barman as a permanent participant in the replication topology rather than an offline batch process.
- **Book vs. today**: this recipe sets `backup_options = exclusive_backup` for Barman and both tools assume the classic `pg_start_backup()`/`pg_stop_backup()` "exclusive backup" API. **PostgreSQL 15 removed exclusive backup mode from core entirely** — only the non-exclusive/concurrent backup API remains. Current Barman and pgBackRest releases target concurrent (non-exclusive) backups by default; the book's explicit `exclusive_backup` setting is not just outdated advice, it targets an API PostgreSQL no longer has as of version 15. Separately, both tools have added **native cloud object storage support** since this book's 2020 baseline — pgBackRest supports `repo-type=s3`/`azure`/`gcs` directly as a repository backend, and Barman gained "Barman Cloud" for pushing backups straight to S3-compatible/Azure/GCS storage — neither tool in 2020 offered this as a first-class configuration option the way both do today.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 8, "Backup Management", recipes "Installing and configuring Barman", "Backing up a database with Barman", "Restoring a database with Barman", "Installing and configuring pgBackRest", "Backing up a database with pgBackRest", "Restoring a database with pgBackRest", p. 342-372](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) — doc
- [Barman Documentation](https://docs.pgbarman.org/) — doc
- [pgBackRest User Guide](https://pgbackrest.org/user-guide.html) — doc
- [PostgreSQL Documentation — Continuous Archiving and Point-in-Time Recovery (PITR)](https://www.postgresql.org/docs/current/continuous-archiving.html) — doc

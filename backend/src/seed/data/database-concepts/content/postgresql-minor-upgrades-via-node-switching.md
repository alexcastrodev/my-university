---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

A highly available server can't just go offline for routine patching — but
security fixes and bug fixes still have to land, on a schedule the database
doesn't get to opt out of. The answer isn't a maintenance window; it's having
a spare copy of the database to switch to. Upgrade the idle replica first,
promote it to take live traffic while the (now demoted) old primary gets
patched in turn, and the database itself is never actually down — only the
role each node plays changes.

## Use Cases

- Applying a routine PostgreSQL minor-version security or bug-fix release
  (e.g., 12.3 → 12.4) to a production primary/replica pair with no
  application-visible downtime.
- Rehearsing a role-switch procedure (which node is primary vs. replica)
  as a side effect of routine patching, so the mechanics are already familiar
  before an unplanned failover ever happens.
- Deciding how to resynchronize the just-demoted node as a fresh replica
  after the switch, and picking a faster tool than a full base backup for it.

## Deep Dive

### Step 1: patch the idle replica first

With a primary at `192.168.1.10` and a replica at `192.168.1.20` behind a
virtual IP (`192.168.1.30`), the replica — not currently serving any traffic
— is the safe one to touch first:

```bash
# on 192.168.1.20, as postgres:
pg_ctl -D /path/to/database stop -m fast

# as a root-capable user:
sudo apt-get install postgresql-12

# as postgres again:
pg_ctl -D /path/to/database start
```

The replica reconnects to the primary and catches back up on WAL it missed
while it was down — the same self-healing streaming replication already
relies on for any brief outage.

### Step 2: isolate and drain the primary, then hand off

Before the primary can be safely stopped, the virtual IP is pulled so no new
connections land on it, and a final `CHECKPOINT` flushes anything still
buffered so the replica has a real chance to fully catch up:

```bash
# root-capable user, on 192.168.1.10:
sudo ip addr del 192.168.1.30/32 dev eth0
```

```sql
-- superuser, on 192.168.1.10:
CHECKPOINT;

-- repeat until the two values match:
SELECT sent_location, replay_location
   FROM pg_stat_replication
  WHERE usename = 'rep_user';
```

Once the positions match, the old primary is stopped and the replica is
promoted — the actual moment of handoff:

```bash
# on 192.168.1.10, as postgres:
pg_ctl -D /path/to/database stop -m fast

# on 192.168.1.20, as postgres:
pg_ctl -D /path/to/database promote
```

```bash
# root-capable user, on 192.168.1.20:
sudo ip addr add 192.168.1.30 dev eth0
```

The virtual IP moving to `192.168.1.20` is what makes the handoff transparent
to applications — they keep talking to `192.168.1.30`, unaware that a
different physical server is now answering. Connection pools may still need
an explicit restart/reconnect signal if they cache TCP connections rather
than re-resolving the address per request.

### Step 3: patch the (now demoted) former primary, then rebuild it as a replica

`192.168.1.10` gets the exact same patch applied while it's no longer live
traffic, then the recipe's default approach to resynchronizing it is a full
wipe-and-reclone:

```bash
# on 192.168.1.10, as postgres:
rm -Rf /path/to/database
pg_basebackup -U rep_user -h 192.168.1.20 -D /path/to/database
```

```ini
# postgresql.conf on 192.168.1.10 (PostgreSQL 12+):
primary_conninfo = 'host=192.168.1.20 port=5432 user=rep_user'
```

```bash
# an empty file named standby.signal in /path/to/database, then:
pg_ctl -D /path/to/database start
```

The two nodes end the procedure with roles fully reversed from where they
started: `192.168.1.20` is now primary, `192.168.1.10` is now the replica —
ready for the exact same procedure next time a patch needs applying.

## Trade-offs

- **The whole procedure depends on the replica being genuinely caught up
  before the primary is stopped.** The `CHECKPOINT` + repeated
  `sent_location`/`replay_location` check is what turns "probably in sync"
  into "confirmed in sync" — skipping it risks promoting a replica that's
  still missing the last few committed transactions.
- **A cached connection pool can keep talking to the old primary's IP even
  after the virtual IP has moved**, if it holds long-lived TCP connections
  instead of re-resolving per request — the book's own step 11 (notify
  developers/support to restart connection pools) exists specifically to
  cover this gap, since the infrastructure switch alone doesn't guarantee
  every client notices.
- **Book vs. today: the book's own verification query already uses column
  names that were renamed before its target PostgreSQL version shipped.**
  `sent_location`/`replay_location` on `pg_stat_replication` were renamed to
  `sent_lsn`/`replay_lsn` in PostgreSQL 10 (2017) — the same gap already
  flagged in this workflow's concept on the "Managing system migrations"
  recipe, which this one explicitly builds on and repeats verbatim. Confirmed
  via the current PostgreSQL documentation.
- **Book gap, not a book-vs-today change: the recipe's own "There's more..."
  section admits the full `pg_basebackup` re-copy is wasteful, and defers to
  a "later recipe" — but `pg_rewind` was already available at the book's own
  PostgreSQL 12 target (introduced in PostgreSQL 9.5) and directly solves
  this.** Instead of erasing and re-copying the entire demoted primary,
  `pg_rewind` only copies the blocks that actually diverged since the two
  nodes' timelines split:
  ```bash
  # instead of rm -Rf + pg_basebackup:
  pg_ctl -D /path/to/database stop -m fast   # ensure the old primary is down
  pg_rewind --target-pgdata=/path/to/database \
            --source-server="host=192.168.1.20 port=5432 user=rep_user dbname=postgres"
  ```
  `pg_rewind` needs either `wal_log_hints = on` in `postgresql.conf` or data
  checksums enabled at `initdb` time on the target cluster — a requirement
  unchanged since its introduction, confirmed via the current documentation.
  On a cluster initialized without either, a full `pg_basebackup` reclone (or
  turning on `wal_log_hints` and restarting first) is still the fallback.
- **Book vs. today: PostgreSQL 18 changed `initdb`'s own default, closing part
  of that prerequisite gap for any newly created cluster.** As of PostgreSQL
  18, data checksums are enabled by default at `initdb` time (opt out via the
  new `--no-data-checksums` flag) — a cluster created on PostgreSQL 18+
  satisfies `pg_rewind`'s requirement automatically, where the book's
  PostgreSQL 12-era clusters needed a deliberate, easy-to-forget opt-in.
  Confirmed via the official PostgreSQL 18 release notes.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 3, "Minimizing Downtime", recipe "Managing software upgrades", p. 122-126 — doc
- [PostgreSQL Documentation — pg_rewind](https://www.postgresql.org/docs/current/app-pgrewind.html) — doc
- [PostgreSQL Documentation — pg_basebackup](https://www.postgresql.org/docs/current/app-pgbasebackup.html) — doc
- [PostgreSQL 18 Release Notes — initdb defaults to enabling data checksums](https://www.postgresql.org/docs/release/18.0/) — doc

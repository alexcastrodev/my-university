---
version: 1.0
updatedAt: 2026-08-03
---
## Objective

A PostgreSQL server that comes back up after a crash or a planned restart is
"available" in the sense that it accepts connections — but every disk block the
operating system and PostgreSQL's own shared buffers had cached is gone. Random
reads that used to come from memory now come from disk, two or three orders of
magnitude slower, and every subsequent query pays for it until the cache rebuilds
naturally under load. Cache warming means deliberately reloading the most
important tables and indexes into memory *before* opening the gates to
applications, so "the database is up" and "the database is fast" become true at
the same time.

## Use Cases

- Bringing a database back online after planned maintenance (a version upgrade,
  a `VACUUM FULL`, a disk swap) without users hitting a cold-cache latency spike
  the moment connections are re-enabled.
- Recovering from an unplanned crash where neither the OS page cache nor
  PostgreSQL's shared buffers survived, and disk bandwidth would otherwise be
  saturated by a flood of random reads for the next several hours.
- Deciding which subset of tables and indexes is worth the effort to warm at
  all — reading an entire multi-terabyte cluster into memory isn't cost
  effective, but the 20 tables that receive most of the index scans usually are.

## Deep Dive

### Building a snapshot of what actually matters

Before anything can be warmed, something has to say which tables and indexes
are worth the effort. The book's recipe builds a static table ranking the top
20 tables and top 20 indexes by how often they're used in scans, together with
each object's on-disk file path:

```sql
DROP TABLE IF EXISTS active_snap;

CREATE TABLE active_snap AS
(SELECT t.relid AS objrelid,
        s.setting || '/' ||
        pg_relation_filepath(t.relid) AS file_path
   FROM pg_stat_user_tables t, pg_settings s
  WHERE s.name = 'data_directory'
  ORDER BY coalesce(idx_scan, 0) DESC
  LIMIT 20)
UNION
(SELECT t.indexrelid AS objrelid,
        s.setting || '/' ||
        pg_relation_filepath(t.indexrelid) AS file_path
   FROM pg_stat_user_indexes t, pg_settings s
  WHERE s.name = 'data_directory'
  ORDER BY coalesce(idx_scan, 0) DESC
  LIMIT 20);
```

This is only an approximation — `idx_scan` is a cumulative counter from the
statistics collector, not a guarantee that the same objects will matter after
restart — but it beats leaving the choice to chance, and it's cheap to rebuild
at any time (it's dropped and recreated fresh every run).

### The one-line fix: `pg_prewarm` (9.4 and above)

With `active_snap` populated *before* shutting the server down, restoring the
cache after PostgreSQL 9.4+ comes back up is a single statement:

```sql
CREATE EXTENSION pg_prewarm;

SELECT pg_prewarm(objrelid)
   FROM active_snap;
```

`pg_prewarm(regclass)` reads every block of the given relation, either straight
into PostgreSQL's shared buffers or via an OS-level prefetch, depending on the
`mode` argument. Run once per row of `active_snap`, it reloads exactly the
tables and indexes the snapshot flagged as important.

### The manual fallback: pgFincore and `dd` (pre-9.4)

For servers old enough to lack `pg_prewarm`, the book falls back to two lower-
level tools. The purely shell-based route preserves the file paths, shuts down,
performs maintenance, then reads each file into the OS cache twice with `dd`
(once to load it, once to mark it as frequently used so the kernel is less
eager to evict it again):

```bash
COPY active_snap (file_path) TO '/tmp/frequent_tables.txt';
-- shut down, do maintenance, then from the shell:
for x in $(tac /tmp/frequent_tables.txt); do
     for y in $x*; do
          dd if=$y of=/dev/null bs=8192
          dd if=$y of=/dev/null bs=8192
     done
done
-- restart PostgreSQL
```

The pure-SQL alternative uses the contributed `pgFincore` extension instead of
shell scripting, blocking new connections to the critical database (all but
`template1`) while it reloads every object from `active_snap`:

```sql
CREATE EXTENSION pgfincore;

UPDATE pg_database SET datallowconn = FALSE WHERE datname != 'template1';

DO $$
DECLARE
     obj_oid oid;
BEGIN
     FOR obj_oid IN SELECT objrelid FROM active_snap
     LOOP
          PERFORM pgfadvise_willneed(obj_oid::regclass);
     END LOOP;
END;
$$ LANGUAGE plpgsql;

UPDATE pg_database SET datallowconn = TRUE;
```

`pgfadvise_willneed` asks the kernel (via `mincore`/`posix_fadvise` semantics)
to preload each relation's pages into the OS page cache — a lower level than
`pg_prewarm`'s shared-buffer focus, and still useful today specifically because
it targets the OS cache rather than PostgreSQL's own memory.

## Trade-offs

- **`active_snap` ranks by cumulative scan counters, not by what will actually
  be hot after restart.** A counter reset (`pg_stat_reset()`) or a crash that
  happens shortly after the snapshot was taken can leave it stale; treat it as
  a reasonable starting guess, not a guarantee, and rebuild it as close to
  shutdown time as practical.
- **Warming the cache doesn't make the underlying I/O disappear — it just moves
  it earlier, off the critical path.** `pg_prewarm` and `dd` both still have to
  physically read every warmed block at least once; on a system with genuinely
  slow disks, that read takes just as long, it simply happens before user
  queries are paying interest on it instead of during.
- **pgFincore is a third-party extension, not a PostgreSQL contrib module** —
  it has to be built and packaged separately (as the book's
  `apt-get install postgresql-12-pgfincore` shows) and depends on OS-level
  facilities (`mincore()`/`fincore()`, `posix_fadvise()`), unlike `pg_prewarm`
  which ships in core and needs nothing beyond `CREATE EXTENSION`.
- **pgFincore is still alive, just slower-moving than in-core `pg_prewarm`.**
  It genuinely lagged behind for a while — PostgreSQL 18 was flagged as a build
  failure on the community's extension-bugs wiki after pgFincore's last regular
  release (1.3.1, September 2023) only covered up to PostgreSQL 16 — but that's
  since been fixed: release 1.4.0 (June 2026) added PostgreSQL 18 and 19
  support, and the GitHub repo is still actively pushed to. It's not abandoned,
  just worth checking before assuming it tracks the newest PostgreSQL major on
  day one, the way an in-core contrib module does.
- **Book vs. today:** the book presents `pg_prewarm` only as the one-line
  `SELECT pg_prewarm(objrelid) FROM active_snap` shown above, and never
  mentions that `pg_prewarm` ships a second piece — the `autoprewarm`
  background worker — which already existed well before PostgreSQL 12. Enabled
  once in `postgresql.conf`:

  ```ini
  shared_preload_libraries = 'pg_prewarm'
  pg_prewarm.autoprewarm = true
  pg_prewarm.autoprewarm_interval = 300s
  ```

  it periodically records the current shared-buffer contents to disk on its
  own, and automatically reloads them on the next server start — the entire
  "snapshot the important objects, reload them after restart" workflow the
  recipe builds by hand with `active_snap`, running unattended with no
  DBA-authored table or manual `SELECT pg_prewarm(...)` step required.
  Confirmed via the official `pg_prewarm` documentation.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 3, "Minimizing Downtime", recipe "Defusing cache poisoning", p. 106-110 — doc
- [PostgreSQL Documentation — pg_prewarm (including the autoprewarm background worker)](https://www.postgresql.org/docs/current/pgprewarm.html) — doc
- [PostgreSQL Documentation — The Cumulative Statistics System (pg_stat_user_tables, pg_stat_user_indexes)](https://www.postgresql.org/docs/current/monitoring-stats.html) — doc
- [pgFincore — GitHub repository and documentation](https://github.com/klando/pgfincore) — doc

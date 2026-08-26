---
version: 1.0
updatedAt: 2026-08-01
---
## Objective

Before a table or index becomes a production incident, PostgreSQL's own statistics
views can already tell you which ones are large, which ones are hot, and which ones
are bloated — no external tooling required. Knowing this ahead of time turns "why is
the database slow" into a targeted question instead of a guessing game.

## Use Cases

- Deciding which tables deserve their own tablespace or more aggressive `autovacuum`
  settings, based on actual size and write volume rather than guesswork.
- Spotting an index that's rarely used and safe to drop, versus one that's read
  constantly and worth protecting from accidental removal.
- Confirming that a table everyone assumes is "just for logging" is actually the
  single largest source of write load on the whole database.
- Measuring exactly how much of a table's disk footprint is reusable dead space
  before deciding whether it needs a `VACUUM FULL`/`CLUSTER`.

## Deep Dive

### Ranking tables and indexes by size

```sql
SELECT oid::regclass::text AS table_name,
       pg_size_pretty(pg_total_relation_size(oid)) AS total_size
  FROM pg_class
 WHERE relkind = 'r'
   AND relpages > 0
 ORDER BY pg_total_relation_size(oid) DESC
 LIMIT 20;
```

`pg_total_relation_size` includes a table's TOAST data and every index on it, so the
ranking reflects the object's true footprint, not just the heap. The equivalent query
against `pg_index` (using `pg_relation_size(indexrelid)`) ranks indexes the same way —
large indexes that aren't primary keys are good candidates for review: a partial index
or a more selective composite key might cover the same queries far more cheaply.

### Ranking by write activity

```sql
SELECT relid::regclass AS table_name,
       n_tup_ins AS inserts,
       n_tup_hot_upd + n_tup_upd AS updates,
       n_tup_del AS deletes
  FROM pg_stat_user_tables
 ORDER BY (n_tup_ins + n_tup_upd + n_tup_hot_upd + n_tup_del) DESC
 LIMIT 20;
```

Tables with a high row-turnover rate are the ones most likely to need manual
`autovacuum`/`autoanalyze` tuning — a table `autovacuum` can't keep up with is a
constant source of bloat.

### Ranking by read activity

```sql
SELECT relid::regclass AS table_name,
       coalesce(seq_scan, 0) AS sequential_scans,
       coalesce(idx_scan, 0) AS index_scans,
       coalesce(seq_tup_read, 0) AS table_matches,
       coalesce(idx_tup_fetch, 0) AS index_matches
  FROM pg_stat_user_tables
 ORDER BY (coalesce(seq_scan, 0) + coalesce(idx_scan, 0)) DESC,
          (coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0)) DESC
 LIMIT 20;
```

A table high on sequential scans relative to index scans is either missing a useful
index or has a query pattern the planner can't use one for. The same query against
`pg_stat_user_indexes` (sorted by `idx_scan`) surfaces the flip side: indexes that
almost never get used at all, which cost write overhead for no read benefit.

### Resetting counters to measure a rate, not a lifetime total

```sql
SELECT pg_stat_reset();
```

Every counter above accumulates from server start (or the last reset) with no
attached timestamp — comparing "inserts today" against "inserts this year" requires
either resetting first or snapshotting and diffing yourself.

### Exact bloat with pgstattuple

```sql
CREATE EXTENSION pgstattuple;

SELECT * FROM pgstattuple('orders');
```

`pgstattuple()` performs a full table scan and returns exact figures — `dead_tuple_percent`,
`free_percent`, and so on. A high `free_percent` means the table is mostly reusable
empty space and is a strong candidate for `CLUSTER` or `VACUUM FULL`; a table that
keeps bloating despite regular `autovacuum` runs is worth flagging to the team that
owns the schema, since the fix is often an application-level access pattern change,
not a database setting.

## Trade-offs

- **`pgstattuple()`'s exactness costs a full table scan.** On a multi-GB table under
  production load, that scan itself adds I/O pressure — `pgstattuple_approx()`
  (available since PostgreSQL 9.5, not mentioned in this recipe) trades some
  precision for a much cheaper, non-full-scan estimate, and is usually the better
  first check before reaching for the exact version.
- **All of these views are per-database.** A PostgreSQL instance with a dozen
  databases needs a dozen connections to build a full instance-wide picture — there's
  no cross-database aggregate view.
- **Book vs. today:** the book's own complaint — "there's no associated timestamp" for
  these counters, forcing a manual reset-and-diff workflow to measure a rate — has a
  partial fix since **PostgreSQL 16**: `pg_stat_user_tables` (and the equivalent index
  view) gained `last_seq_scan` and `last_idx_scan` columns, giving a direct answer to
  "when was this table last scanned this way" without resetting anything. It doesn't
  replace `pg_stat_reset()` for measuring a rate of change, but it closes the specific
  "how recent is this activity" gap the book flags as a limitation.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 3, "Minimizing Downtime", recipe "Identifying important tables", p. 100-105 — doc
- [PostgreSQL Documentation — The Cumulative Statistics System (pg_stat_user_tables, pg_stat_reset)](https://www.postgresql.org/docs/current/monitoring-stats.html) — doc
- [PostgreSQL Documentation — pgstattuple](https://www.postgresql.org/docs/current/pgstattuple.html) — doc
- [PostgreSQL 16 Release Notes — last_seq_scan/last_idx_scan added to pg_stat_*_tables](https://www.postgresql.org/docs/16/release-16.html) — doc

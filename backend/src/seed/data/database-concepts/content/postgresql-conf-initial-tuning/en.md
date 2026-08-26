---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

A highly available PostgreSQL server should start with a stable `postgresql.conf`
rather than accumulate settings reactively after outages. Most of the values that
matter fall into a few families — connection and memory sizing, WAL/checkpoint
behavior, replication readiness, planner cost estimates, and logging — and each
family has a defensible starting formula instead of an arbitrary guess.

## Use Cases

- Provisioning a new PostgreSQL server and wanting a defensible starting
  configuration instead of the out-of-the-box defaults, which are tuned for minimal
  resource usage, not production availability.
- Deciding how much memory to give `work_mem` and `shared_buffers` based on
  total system RAM, without either starving queries or triggering large,
  availability-threatening checkpoint write storms.
- Preparing a primary to support future streaming or logical replicas without a
  restart later — several of these settings only take effect after a full PostgreSQL
  restart, so getting them right up front avoids a second outage.

## Deep Dive

### Connection and memory sizing

- `max_connections`: roughly 3× CPU core count (including virtual/hyperthreaded
  cores) — erring slightly high avoids visible connection rejections at the cost of a
  little headroom.
- `shared_buffers`: 25% of RAM for servers up to 32GB; for larger servers, start at
  8GB and test upward in 2GB increments rather than continuing the 25% rule,
  since a forced checkpoint can flush an amount of RAM equal to `shared_buffers`
  to disk all at once — a write storm that can cripple even capable hardware.
- `work_mem`: 8MB / 16MB / 32MB depending on total RAM tier, halved if
  `max_connections` exceeds 400 — each connection can use several instances of
  this simultaneously (sorts, hashes), so it multiplies fast under high concurrency.
- `maintenance_work_mem`: 1GB, reserved for background work (vacuum, analyze,
  index builds) — starving it increases disk I/O in ways that hurt query
  performance broadly, not just maintenance jobs.

### WAL, checkpoints, and vacuum aggressiveness

- `wal_level`: needs to allow at least one streaming standby, so it can't stay at the
  default minimal setting.
- `min_wal_size` / `max_wal_size`: sized so PostgreSQL doesn't force checkpoints
  just because it ran out of WAL segments during a burst of write activity —
  roughly 10% of system RAM as a starting point.
- `vacuum_cost_limit`: raised from the default so autovacuum is aggressive enough
  on larger, active OLTP tables — too passive an autovacuum risks the transaction
  ID wraparound scenario, where PostgreSQL preemptively shuts itself down to
  avoid data loss, which is about as availability-threatening as a setting gets.
- `checkpoint_completion_target`: spreads checkpoint writes over more of the
  `checkpoint_timeout` window instead of bursting them, reducing disk contention.

### Replication readiness

- `hot_standby`: on, so replicas produced later are immediately usable for reads.
- `max_wal_senders`: enough slots for the synchronization/backup methods a
  cluster will actually use — 10 is a reasonable starting point.
- Retaining enough WAL for a replica that temporarily falls behind, so it doesn't
  permanently lose the ability to catch up and require a full rebuild.

### Planner cost estimates and logging

- `random_page_cost`: lowered from the default to reflect fast storage — SSD/PCIe
  storage has far less difference between random and sequential reads than
  spinning disks assume.
- `effective_cache_size`: roughly 75% of RAM, telling the planner how much data is
  likely already cached by the OS — this nudges the planner toward indexes when
  the underlying data is probably in memory.
- `log_min_duration_statement`: logs only queries slower than a threshold (in
  milliseconds), avoiding both silence on slow queries and a flooded log from
  logging everything.
- `log_checkpoints` and `log_statement = ddl`: checkpoint timing/frequency
  visibility, and an audit trail of schema changes.

### `pg_settings`: which of these need a restart

Not every setting here takes effect the same way — `pg_settings.context` tells you
which ones require a full restart (`postmaster`) versus a reload or per-session
`SET`. Getting the restart-requiring settings right on day one matters more than the
rest, precisely because fixing a mistake later costs an outage.

### Book vs today: several settings were renamed, removed, or became the default

The book's checklist maps onto current PostgreSQL with a handful of concrete
changes since 2020:

- **`wal_level = hot_standby` → `replica`.** Renamed in PostgreSQL 9.6 (the old
  `hot_standby`/`archive` values were merged into `replica`). The old name is still
  silently accepted for backward compatibility, but `replica` is what current configs
  should say.
- **`wal_keep_segments` → `wal_keep_size`.** Removed in PostgreSQL 13 and
  replaced by `wal_keep_size`, specified directly in MB instead of a segment count
  — no more manually multiplying a segment count by 16MB to reason about disk
  usage.
- **`checkpoint_completion_target`'s default changed from 0.5 to 0.9 in
  PostgreSQL 14.** The book's manual recommendation to set this to 0.9 is now
  simply what a fresh install already ships with — nothing to override anymore on
  a current version.
- **`replication_slots` was always shorthand for `max_replication_slots`** — the
  book's naming is imprecise, not outdated; the actual parameter has defaulted to
  10 since PostgreSQL 10, matching the book's recommended starting value.
- **`max_wal_senders`'s default of 10 is unchanged** since PostgreSQL 10 — still a
  reasonable value to rely on rather than override.
- **"3× cores" for `max_connections` is still a reasonable starting heuristic, but
  current guidance leans harder toward pooling than the book does.** Every
  additional connection carries real shared-memory and per-backend-process
  overhead; once concurrent connections climb into the hundreds, the current
  recommendation is an external connection pooler (PgBouncer, PgCat) in front of
  PostgreSQL rather than continuing to raise `max_connections` directly.
  PostgreSQL itself still has no built-in pooler as of the current stable release —
  this remains an operational addition, not a `postgresql.conf` setting.

## Trade-offs

- **These formulas are starting points a real workload should override, not fixed
  targets.** The book itself points to `pgtune` for automated estimation, with the
  caution that it tends to be liberal about `work_mem` and `shared_buffers` —
  useful as a better baseline than PostgreSQL's own defaults, not a substitute for
  measuring an actual workload.
- **Raising `vacuum_cost_limit` trades I/O now for avoiding a much worse outage
  later.** A more aggressive autovacuum competes with query traffic for I/O
  bandwidth continuously, in exchange for avoiding the transaction ID wraparound
  shutdown — a trade worth making for any server that can't tolerate that failure
  mode.
- **Several of the highest-impact settings here (`wal_level`, `shared_buffers`,
  `max_connections`, `max_wal_senders`) require a restart to change** — getting
  them approximately right before a server takes production traffic is worth more
  than getting them exactly right, since "exactly right" discovered later still costs
  an outage to apply.

## Documentation Links

- Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 3, "Minimizing Downtime", recipe "Configuration – getting it right the first time", p. 91-96 — doc
- [PostgreSQL Documentation — Server Configuration](https://www.postgresql.org/docs/current/runtime-config.html) — doc
- [PostgreSQL Documentation — Write Ahead Log Configuration](https://www.postgresql.org/docs/current/runtime-config-wal.html) — doc
- [PostgreSQL Documentation — pg_settings](https://www.postgresql.org/docs/current/view-pg-settings.html) — doc
- [PGTune — configuration estimator](https://pgtune.leopard.in.ua/) — doc
- [PostgreSQL Documentation — Replication settings (wal_keep_size, max_replication_slots, max_wal_senders)](https://www.postgresql.org/docs/current/runtime-config-replication.html) — doc
- [EnterpriseDB — Why you should use connection pooling with max_connections](https://www.enterprisedb.com/postgres-tutorials/why-you-should-use-connection-pooling-when-setting-maxconnections-postgres) — doc

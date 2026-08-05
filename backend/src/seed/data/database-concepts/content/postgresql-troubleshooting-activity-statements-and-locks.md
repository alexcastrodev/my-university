---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

Three built-in views answer almost every "what is the database doing right now, and why is it slow?" question: `pg_stat_activity` (what every connection is doing this instant), `pg_stat_statements` (aggregate performance of every query pattern over time), and `pg_locks` combined with `pg_blocking_pids()` (who's blocking whom). None of these require external tooling — they're part of PostgreSQL itself — but two of the three are locked down by default and need deliberate setup before a non-superuser can use them for routine monitoring.

## Use Cases

- Diagnosing a sudden spike in active connections or query duration in real time via `pg_stat_activity`, without waiting for logs to catch up.
- Finding the query that's quietly responsible for 50% of total database load — not because any single execution is slow, but because it runs constantly (`pg_stat_statements`, sorted by `calls` or total time).
- Tracking down exactly which session is blocking a stuck transaction, and what query it's running, instead of guessing from symptoms alone (`pg_locks` + `pg_blocking_pids()`).
- Building a monitoring dashboard or alerting rule that needs read access to this data without granting full superuser privileges to the monitoring account.

## Deep Dive

### `pg_stat_activity`: what every connection is doing right now

```sql
SELECT pid, usename, state, wait_event, query_start, query
  FROM pg_stat_activity;
```

Key columns: `pid` (the OS process id — useful for `kill`/correlating with `strace`), `state` (`active`, `idle`, `idle in transaction`, or the more alarming `idle in transaction (aborted)` — a transaction that hit an error and was never rolled back or disconnected, a classic connection-leak symptom), `wait_event` (what a blocked query is waiting on — a lock, disk I/O, a background worker), and `query`/`query_start` (the current or most recent statement and when it began). `state_change` tells you how long a connection has sat in its current state — a session stuck `idle in transaction` for hours is a strong signal of an application bug holding a transaction open.

### Making `pg_stat_activity` and `pg_stat_statements` safe for non-superusers

By default, only a superuser can see the full contents of these views (query text and connection details are hidden from other users, for good reason — they can leak sensitive data). The historical technique for delegating read access without granting superuser was a `SECURITY DEFINER` wrapper function:

```sql
CREATE OR REPLACE FUNCTION pg_stat_activity() RETURNS SETOF pg_stat_activity AS $$
    SELECT * FROM pg_stat_activity;
$$ LANGUAGE sql SECURITY DEFINER;

REVOKE ALL ON FUNCTION pg_stat_activity() FROM PUBLIC;

CREATE USER db_mon WITH PASSWORD 'somepass';
GRANT EXECUTE ON FUNCTION pg_stat_activity() TO db_mon;
```

`SECURITY DEFINER` makes the function execute with the privileges of whoever *created* it (a superuser), not whoever *calls* it — so a function created by `postgres` and then granted to `db_mon` lets `db_mon` see the unrestricted view contents through the function, without ever being a superuser itself. The same pattern applies verbatim to `pg_stat_statements`.

### `pg_stat_statements`: aggregate query performance over time

```sql
-- one-time setup: postgresql.conf, then restart
shared_preload_libraries = 'pg_stat_statements'
```
```sql
CREATE EXTENSION pg_stat_statements;

SELECT query, calls, total_exec_time, rows
  FROM pg_stat_statements
 ORDER BY calls DESC
 LIMIT 10;
```

Unlike `log_min_duration_statement` (which only captures *slow* queries), `pg_stat_statements` aggregates *every* distinct query pattern (with literals normalized out) — `calls`, total execution time, rows returned — regardless of speed. A query that individually takes 2ms but runs 50,000 times/second can dominate server load while never once triggering a slow-query log entry; sorting by `calls` or total time is how that pattern actually gets found. `SELECT pg_stat_statements_reset();` clears accumulated statistics when a fresh baseline is needed (e.g., after a deploy).

### Finding what's blocking what: `pg_locks` and `pg_blocking_pids()`

```sql
-- what's locked, and is the lock granted or waiting?
SELECT pid, locktype, mode, granted,
       relation::REGCLASS::TEXT AS locked_object
  FROM pg_locks
 WHERE relation IS NOT NULL
 ORDER BY relation, granted DESC;

-- the actual blocker → blocked relationship (PostgreSQL 9.6+)
SELECT p.pid, p.query, s.pid AS blocker_pid, s.query AS blocker_query
  FROM pg_stat_activity p
  JOIN pg_stat_activity s ON (s.pid = ANY(pg_blocking_pids(p.pid)));
```

`pg_locks` alone only shows resource contention — two PIDs wanting the same object — without stating cause and effect. `pg_blocking_pids(pid)` (added in PostgreSQL 9.6) closes that gap directly: given a blocked process's PID, it returns the array of PIDs actually blocking it, which the second query joins back against `pg_stat_activity` to show both queries side by side — the stuck query and the one holding the lock it's waiting on.

## Trade-offs

- **`idle in transaction (aborted)` is invisible before PostgreSQL 9.2** — this `state` value doesn't exist in older versions, which only report `current_query` with no separate state tracking; if triaging an old, unsupported PostgreSQL version, the diagnostic signal simply isn't there.
- **`pg_stat_statements` truncates query text and caps tracked patterns** — the `query` column shows up to 1,024 characters, and the module only remembers the first N distinct query patterns it sees (`pg_stat_statements.max`, default several thousand) before evicting the least-used ones; a workload with extremely high query-shape variance (e.g., dynamically generated SQL with unparameterized literals) can blow past this and lose visibility into rarer patterns.
```sql
-- raise the tracked-pattern ceiling (requires a restart)
-- postgresql.conf: pg_stat_statements.max = 10000
```
- **A `SECURITY DEFINER` wrapper function is powerful and easy to get wrong** — forgetting the `REVOKE ALL ... FROM PUBLIC` step leaves the elevated-privilege function callable by *any* authenticated user, effectively handing out superuser-level visibility into every query on the server by accident.
- **Book vs. today**: the `SECURITY DEFINER`-wrapper-function dance for `pg_stat_activity`/`pg_stat_statements` predates PostgreSQL's built-in **predefined roles** (`pg_monitor`, `pg_read_all_stats`, `pg_read_all_settings`), introduced in **PostgreSQL 10** — before this book's PostgreSQL 12 baseline. Today, the entire custom-function setup collapses to one line: `GRANT pg_monitor TO db_mon;` grants a monitoring account full read access to `pg_stat_activity`, `pg_stat_statements`, and other stats views directly, with no wrapper function, no `REVOKE`, and no risk of forgetting the revoke step. The book's manual technique still works and is worth understanding (it's the same underlying mechanism many older or custom monitoring setups still use), but isn't the simplest current path.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 5, "Troubleshooting", recipes "Checking the pg_stat_activity view", "Checking the pg_stat_statements view", "Deciphering database locks", p. 203-215](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) — doc
- [PostgreSQL Documentation — The Statistics Collector (pg_stat_activity)](https://www.postgresql.org/docs/current/monitoring-stats.html) — doc
- [PostgreSQL Documentation — pg_stat_statements](https://www.postgresql.org/docs/current/pgstatstatements.html) — doc
- [PostgreSQL Documentation — Predefined Roles (pg_monitor, pg_read_all_stats)](https://www.postgresql.org/docs/current/predefined-roles.html) — doc
- [PostgreSQL Documentation — pg_locks](https://www.postgresql.org/docs/current/view-pg-locks.html) — doc

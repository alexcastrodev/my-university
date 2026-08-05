---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

A monitoring stack needs three distinct jobs done well: collecting metrics from every server (Telegraf), storing them efficiently as time-series data (InfluxDB), and turning them into graphs and dashboards a human can actually act on (Grafana). None of the three do all three jobs — each is a specialist, and the pipeline is push-based: Telegraf polls PostgreSQL on an interval and pushes what it finds downstream, rather than something reaching in and pulling metrics out on demand.

## Use Cases

- Watching replication slot lag over time (not just its current value) to see exactly when a standby started falling behind and for how long — critical because a lagging slot means PostgreSQL is retaining WAL indefinitely, which can exhaust disk space if unnoticed.
- Tracking transaction ID (XID) age across all databases to get advance warning of an approaching wraparound-driven forced shutdown, rather than discovering it when the database refuses to accept new transactions.
- Building a live "session health" panel — active vs. idle-in-transaction counts, queries running longer than a threshold — that surfaces contention symptoms before they escalate into an outage.
- Extending monitoring coverage to anything expressible as SQL, since the collector plugin used here executes arbitrary queries on a schedule rather than being limited to a fixed built-in metric set.

## Deep Dive

### The pipeline: Telegraf → InfluxDB → Grafana

```
PostgreSQL server (pgha1)          Monitoring server (pgmon)
┌─────────────────────┐            ┌───────────┐    ┌─────────┐
│ Telegraf agent       │──push───▶ │ InfluxDB   │◀──│ Grafana │
│ (polls every 10s)    │           │ (time-series store) │  (dashboards)
└─────────────────────┘            └───────────┘    └─────────┘
```

Telegraf runs on every PostgreSQL node being monitored and polls it locally (avoiding the overhead of a remote connection per metric collection cycle); InfluxDB runs centrally, ingesting metrics from every Telegraf agent in the fleet; Grafana queries InfluxDB to render dashboards. Each layer can be swapped independently — Grafana pointed at a different backend, or a different collector feeding the same InfluxDB instance — because the pipeline stages only agree on a data format, not a vendor.

### The basic PostgreSQL input: a starting point, not the ceiling

```ini
# /etc/telegraf/telegraf.d/pgha1.conf
[[inputs.postgresql]]
  address = "host=pgha1 user=postgres"
  outputaddress = "pgha1"
  max_lifetime = "0s"
  databases = ["pgbench"]
```

`max_lifetime = "0s"` keeps Telegraf's connection to PostgreSQL persistent instead of reconnecting every poll cycle. This built-in plugin gives basic connection/throughput metrics, but the real power is in the *extensible* variant, which runs arbitrary SQL on a schedule.

### The extensible plugin: monitoring is just writing a query

```ini
[[inputs.postgresql_extensible]]
  address = "host=pgha1 user=perf_mon dbname=postgres"
  outputaddress = "pgha1"
  max_lifetime = "0s"
  databases = ["pgbench"]

[[inputs.postgresql_extensible.query]]
  sqlquery = """
    SELECT slot_name,
           pg_wal_lsn_diff(pg_current_wal_insert_lsn(), restart_lsn)::BIGINT AS restart_lsn_lag,
           pg_wal_lsn_diff(pg_current_wal_insert_lsn(), confirmed_flush_lsn)::BIGINT AS confirmed_flush_lag
      FROM pg_replication_slots
  """
  version = 940
  withdbname = false
  tagvalue = "slot_name"
  measurement = "postgresql.slot_lag"

[[inputs.postgresql_extensible.query]]
  sqlquery = """
    SELECT count(*) AS total,
           count(*) FILTER (WHERE state LIKE 'idle in%') AS trans_idle,
           count(*) FILTER (WHERE state = 'active') AS active,
           count(*) FILTER (WHERE wait_event IS NOT NULL) AS waiting,
           count(*) FILTER (WHERE state = 'active' AND now() - state_change > INTERVAL '1s') AS slow
      FROM pg_stat_activity
  """
  version = 960
  withdbname = false
  measurement = "postgresql.sessions"
```

Each `[[inputs.postgresql_extensible.query]]` block is a full SQL query executed every poll interval. `version` gates which PostgreSQL releases the query is valid for (Telegraf skips a query on servers older than its declared version — written as `960` for 9.6.0, not `9.6.0`); `tagvalue` marks which returned column is a label rather than a metric (here, `slot_name`, so each replication slot's lag can be filtered/grouped independently in Grafana); `measurement` names the metric series. The monitoring user only needs `pg_read_all_stats` — a predefined role, not superuser — to run queries like the session-activity one against `pg_stat_activity`.

### Storage and visualization

```
# InfluxDB: a time-series database Telegraf pushes into
# Grafana: points at InfluxDB as a data source (URL, database name, HTTP method),
#          then builds panels by picking a measurement + fields + aggregation
```

Grafana organizes panels into dashboards; a panel queries a `measurement` (like `postgresql.sessions` above) and picks which fields to plot, with point-and-click aggregation (mean, sum, over a time bucket) rather than hand-written query syntax for the common case. The three custom queries shown above map directly to dashboard panels worth having in any PostgreSQL HA setup: replication slot lag (disk-exhaustion risk if ignored), XID age (wraparound-shutdown risk if ignored), and session-state counts (contention/backlog symptoms).

## Trade-offs

- **A custom SQL query in the extensible plugin runs on every poll cycle, on every monitored server** — an expensive or lock-taking diagnostic query is fine to run manually once, but running it every 10 seconds across a whole fleet is a very different cost; keep collector queries cheap and index-friendly, and reserve heavier diagnostics for on-demand use.
- **Replication slots create a hard dependency between monitoring and disk safety** — a slot's lag isn't just a performance metric, it's WAL retention: an unmonitored, growing slot lag means PostgreSQL is holding WAL files indefinitely for a standby that may be down, and can fill the disk. This is exactly why the book calls this metric out as something generic tools like Nagios don't track natively — it needs a PostgreSQL-aware collector.
- **`version` gating means the same conceptual metric may need multiple query variants** — a fleet running a mix of PostgreSQL versions can't always share one query definition; a query written against 9.6-only columns (like `wait_event`) simply won't run against older servers, by design, rather than failing loudly.
```ini
# same metric, older-version-compatible variant would need to drop wait_event
# and any column/view introduced after the target version
```
- **Book vs. today**: this recipe uses **InfluxDB 1.x** (a `telegraf` "database", InfluxQL implicitly, HTTP POST as the Grafana connection method) — the current InfluxDB line has moved through two significant redesigns since: **InfluxDB 2.x** replaced the database/retention-policy model with buckets and token-based auth, and introduced **Flux** as the primary query language; **InfluxDB 3.x** re-added support for both InfluxQL and standard **SQL**, alongside a columnar storage engine rewrite. None of this changes Telegraf's *collection* side (the `postgresql_extensible` plugin and its query blocks work the same), but the storage/query layer this recipe describes is specifically the 1.x-era shape. Separately, **Prometheus + Grafana** (with the community `postgres_exporter`) has become a widely-adopted pull-based alternative to this push-based Telegraf/InfluxDB pipeline — worth knowing as a second valid path, not a replacement the book's approach requires switching to.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 6, "Monitoring", recipes "Installing and configuring Telegraf", "Adding a custom PostgreSQL monitor to Telegraf", "Installing and configuring InfluxDB", "Installing and configuring Grafana", "Building a graph in Grafana", p. 249-268](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) — doc
- [Telegraf postgresql_extensible input plugin](https://github.com/influxdata/telegraf/tree/master/plugins/inputs/postgresql_extensible) — doc
- [InfluxDB Documentation](https://docs.influxdata.com/) — doc
- [Grafana Documentation](https://grafana.com/docs/) — doc
- [prometheus-community/postgres_exporter](https://github.com/prometheus-community/postgres_exporter) — doc

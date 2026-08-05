---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

A PostgreSQL connection is expensive — each one is a full OS process with its own memory footprint, and performance degrades once active connections exceed roughly 2-3x the CPU core count. Applications, meanwhile, want to open connections liberally. Two layers close that gap: HAProxy sits in front of the cluster to abstract *which server* a client talks to (routing writes to the primary, spreading reads across replicas), and PgBouncer sits in front of PostgreSQL itself to abstract *how many real connections* are actually needed, multiplexing many client connections onto a much smaller pool of database connections.

## Use Cases

- Preventing a fleet of application servers (each holding its own connection pool) from collectively overwhelming PostgreSQL with far more connections than the hardware can serve efficiently.
- Routing read-only traffic across multiple standby replicas via HAProxy's `leastconn` balancing, so replicas do useful work instead of sitting idle as pure failover targets.
- Reducing per-connection overhead for applications that open (and abandon) connections frequently, by having PgBouncer recycle a small set of real PostgreSQL connections instead of the OS spinning up a new backend process per client.
- Sizing a connection pool from first principles (available RAM, CPU cores, disk spindles) instead of guessing a round number.

## Deep Dive

### Sizing the pool before configuring anything

The book's formula: estimate per-connection RAM as 8 MB baseline plus 4× `work_mem`, then see how many of those fit in half the server's RAM; separately, estimate a CPU/IO-bound ceiling as `2 × cores + disk spindles` (+100 if SSD-backed). The *lower* of the two numbers is the practical connection ceiling — whichever resource is scarcer sets the limit.

```
RAM-based:  (RAM_MB / 2) / (8 + 4 × work_mem_MB)
CPU-based:  (2 × cores) + spindles   (+100 if SSD)
pool_size = min(RAM-based, CPU-based)
```

A worked example from the book: 32 GB RAM, 8 cores, 8 spindles, `work_mem = 8MB` → RAM allows ~409 connections, but CPU/IO caps it at 24. The lower number wins — the pool should target something close to 24, not 409, because CPU/IO is the actual bottleneck here.

### HAProxy: routing to the right node

```
frontend ft_postgresql
    bind *:5432
    default_backend bk_db

backend bk_db
    option pgsql-check user haproxy_check
    server postgresql_primary pgha1:5432 check
```

A frontend binds a port and forwards to a backend; the backend lists candidate PostgreSQL servers and how to health-check them (`pgsql-check`, using a dedicated login-only role that doesn't need database access — just enough to prove the server responds). For read scaling, a second frontend/backend pair on a different port (e.g. `5500`) lists every replica with `balance leastconn`, sending each new session to whichever node currently holds the fewest connections:

```
frontend ft_pg_ro
    bind *:5500
    default_backend bk_pg_ro

backend bk_pg_ro
    balance leastconn
    option pgsql-check user haproxy_check
    server postgresql_pgha1 pgha1:5432 check
    server postgresql_pgha2 pgha2:5432 check
    server postgresql_pgha3 pgha3:5432 check
```

Applications that can tolerate replica lag point read-heavy traffic at the read port; write traffic stays on the primary-only port. This is the same abstraction principle as a virtual IP (masking which physical node is "the" primary), but extended to load-balance across many read replicas at once — something a single virtual IP address can't do.

### PgBouncer: multiplexing many clients onto few real connections

```ini
[databases]
* = host=pgha1

[pgbouncer]
listen_addr = *
auth_type = md5
admin_users = postgres
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
```

`default_pool_size` is per-user-per-database — the calculated ideal connection count from the sizing formula above. `max_client_conn` caps how many *client* connections PgBouncer itself accepts (much higher than the real pool, since clients wait in an internal queue rather than each holding a real PostgreSQL connection). Authentication is handled via a separate `userlist.txt` file PgBouncer maintains itself, since it isn't a PostgreSQL extension and has no direct access to `pg_authid`.

### `pool_mode`: the setting that changes application compatibility

- **`session`** (default) — a connection stays assigned to one client until it disconnects. Safest, but a client that never disconnects (or an app with poor connection hygiene) can monopolize a slot indefinitely.
- **`transaction`** — a connection returns to the pool as soon as a transaction commits or aborts, letting far more clients share the same small pool. The trade-off: session-level state (like a `SET` that isn't reset, or a cursor meant to persist across transactions) breaks, because the next statement may land on a different physical connection.
- **`statement`** — released after every single statement; multi-statement transactions aren't allowed. Rarely the right choice for a general-purpose PostgreSQL workload.

`transaction` mode is the one that actually delivers PgBouncer's multiplexing benefit at scale, which is why the book spends its "there's more" section on the caveats needed to use it safely.

## Trade-offs

- **`leastconn` load balancing doesn't account for replica lag** — HAProxy's health check confirms a replica is *reachable*, not that it's *caught up*; an application sensitive to stale reads needs its own lag-awareness (checking `pg_last_wal_replay_lsn()`/`pg_stat_replication` before trusting a replica), which HAProxy alone doesn't provide.
- **`transaction` pool_mode trades session features for scale** — anything that depends on connection-scoped state (advisory locks held across statements, `LISTEN`/`NOTIFY`, session-level `SET` variables, cursors meant to outlive one transaction) can silently misbehave under `transaction` mode, because the client's next statement isn't guaranteed to land on the same backend connection.
```ini
; only safe when the application genuinely doesn't rely on session state
; between transactions:
pool_mode = transaction
```
- **Regenerating PgBouncer's `userlist.txt` doesn't happen automatically** — since PgBouncer isn't part of PostgreSQL's authentication system, a new role or a changed password requires re-exporting and redistributing this file (or delegating to LDAP/PAM), which is an operational step easy to forget after routine user management.
- **Book vs. today**: the source material treats prepared statements as fundamentally incompatible with `transaction` pool_mode ("we generally don't suggest using transaction mode while prepared statements... are present"). Since **PgBouncer 1.21** (2023), that caveat is substantially outdated for protocol-level prepared statements: the `max_prepared_statements` setting (default 200 in recent releases) lets PgBouncer track and cache prepared statements per client across pooled connections, automatically re-preparing them on whichever backend a client lands on — closing the exact gap the book warns about, for the common case of protocol-level (not `PREPARE`-SQL-statement-level) prepared queries.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020) — Chapter 4, "Proxy and Pooling Resources"](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) — doc
- [HAProxy Configuration Manual](https://cbonte.github.io/haproxy-dconv/) — doc
- [PgBouncer Configuration Reference](https://www.pgbouncer.org/config.html) — doc
- [PgBouncer FAQ](https://www.pgbouncer.org/faq.html) — doc

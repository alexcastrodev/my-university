---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

A Rails app's database connection pool is bounded by simple arithmetic —
processes × threads × hosts — that has to stay under whatever the Postgres
plan actually allows, including at the exact moment a deploy briefly runs
old and new dynos side by side. Getting this math wrong shows up as
intermittent `ActiveRecord::ConnectionTimeoutError` under load, and adding
`pgbouncer` in front changes the math again in a way that's easy to get
backwards.

## Use Cases

- Sizing `RAILS_MAX_THREADS` (which sets the pool size) against the
  database's real connection limit, accounting for deploy-time overlap.
- Deciding whether pgbouncer's `default_pool_size` should be calculated
  from thread count or from the plan's connection ceiling — these give very
  different, easy-to-confuse numbers.
- Diagnosing a connection-pool bottleneck from APM data before it becomes
  visible as user-facing timeouts.
- Understanding the actual trade-off `pool_mode: transaction` makes
  (prepared statements) before turning it on to survive a connection
  crunch.

## Deep Dive

### The base math, and why deploys are the risky moment

```ruby
# config/database.yml
production:
  pool: <%= ENV.fetch("RAILS_MAX_THREADS", 5) %>
```

Rails' default connection pool size equals `RAILS_MAX_THREADS` — one
connection reserved per thread. Total possible connections across the
fleet is `processes × threads × hosts`, and that number has to stay under
the database's real limit (e.g. Heroku Postgres "standard-0" caps at 120).
The number that actually matters isn't steady-state usage — it's the peak
during a **preboot deploy**, where old and new dynos briefly run
simultaneously and can roughly double the connection count for that
window.

### pgbouncer: a different pool, sized a different way

```ini
# pgbouncer.ini
pool_mode = transaction
default_pool_size = 20
```

`default_pool_size` in pgbouncer is **per pgbouncer instance** — with one
instance per dyno (the common setup on Heroku's buildpack), the right
formula is:

```
default_pool_size = (plan_connection_limit - deploy_overlap_margin) / active_dyno_count
```

not `threads × processes`. Sizing it as if it were the Rails-side pool
defeats the purpose of adding pgbouncer at all — the whole point is that
pgbouncer multiplexes many app-side connections onto fewer real Postgres
connections.

`pool_mode: transaction` releases a database connection back to the pool
the moment a transaction ends, rather than holding it for the client's
entire session — this is what lets a small pgbouncer pool serve a much
larger number of Rails threads. The real cost: it **disables prepared
statements**, because a prepared statement is tied to a specific backend
connection that transaction-mode pooling doesn't guarantee you'll get
twice in a row. That's a genuine trade-off (a small performance and
security-hardening feature), not a free lunch.

### Diagnosing a too-small pool

```
# In APM traces, a growing amount of time spent here is the tell:
ActiveRecord::QueryCache middleware
```

A connection pool that's too small under load doesn't usually show up as
an obvious error first — it shows up as request time quietly shifting into
waiting for a connection, visible in APM as elevated time in the
`ActiveRecord::QueryCache` (or equivalent connection-checkout) middleware,
before it eventually surfaces as `ConnectionTimeoutError` once the wait
exceeds `checkout_timeout`.

## Trade-offs

- **`pool_mode: transaction` trades away prepared statements** — a real
  cost, not a configuration nicety, and worth confirming the app doesn't
  depend on them (some gems assume prepared statements are available) before
  flipping it on to solve a connection crunch.
- **Sizing pgbouncer's `default_pool_size` as `threads × processes`
  defeats its purpose** — it should be sized against the database's real
  connection ceiling divided by dyno count, not mirrored from the Rails
  pool size.
- **The number that actually causes production incidents is the deploy-time
  peak, not steady-state usage** — a pool sized correctly for normal traffic
  can still exhaust the database's connection limit during a preboot
  window unless that overlap is explicitly budgeted for.

## Documentation Links

- [Configuring Rails Applications — Database Pooling](https://guides.rubyonrails.org/configuring.html#database-pooling) — doc
- [PgBouncer — Official documentation](https://www.pgbouncer.org/config.html) — doc
- [The Complete Guide to Rails Performance — Interacting with (SQL) Databases](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc

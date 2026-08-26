---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

37signals ran Resque against Redis for years at Basecamp and HEY, and by their
own account still needed **seven separate gems** — `resque`, `resque-pool`,
`resque-scheduler`, `resque-pause`, `resque_supervised_fork`,
`sequential_jobs`, `scheduled_job` — just to get job pausing, scheduling, and
supervised forking that a single well-designed backend should provide. Solid
Queue replaced all seven with one dependency backed by the app's own
database, and by late 2024 was running roughly 20 million jobs a day for HEY
alone. Solid Cache did something similar for caching: swapping Redis/Memcached
for a database table dropped Basecamp's cache-store cost by roughly 80% while
growing cache retention from days to months, and cut Basecamp's P95 request
duration from 375ms to 225ms — not because disk got faster than RAM, but
because a **cache six times larger** meant far fewer cold misses. This concept
is about what you actually get, and give up, when you let Rails 8's default
database-backed trio replace Redis rather than reaching for Sidekiq and
Redis-backed Action Cable out of habit.

## Use Cases

- Standing up a new Rails 8 app and deciding whether to keep the
  Solid Queue / Solid Cache / Solid Cable defaults or swap in Redis-backed
  Sidekiq and Action Cable before you've even deployed once.
- Running on a single server (or a handful, via Kamal) where every accessory
  service — Redis, a separate cache daemon, a pubsub broker — is one more
  thing to provision, patch, and pay for.
- Debugging a stuck or duplicated job by querying `solid_queue_jobs` and
  `solid_queue_failed_executions` directly with SQL, instead of reaching for
  `redis-cli` or a Sidekiq Web UI.
- Deciding whether a growing WebSocket feature (live notifications, a chat
  widget, dashboard updates) is still within Solid Cable's comfort zone, or
  whether it's crossed into "reach for Redis" territory.
- Choosing where to put a large, long-lived fragment cache when the honest
  bottleneck is cache *size* (hit rate), not per-read latency.
- Sizing the database connection pool once workers, dispatchers, cache
  expiry threads, and Cable pollers are all competing for connections
  alongside web requests.

## Deep Dive

### Why the "solid trio" exists

Rails 8 made three database-backed adapters — Solid Queue (jobs), Solid Cache
(cache store), and Solid Cable (Action Cable pubsub) — the default for new
apps, replacing what used to require Redis plus, in most real apps, a
separate job-queue gem on top. DHH's Rails 8.0 announcement frames the "why"
around deployment cost and a hardware observation, not around a benchmark
win: *"Nobody should have to pay orders of magnitude more for basic computing
just to make deployment friendly and usable"* — the animating idea behind
Rails 8 pairing the Solid trio with Kamal 2 for a "no PaaS required" one- or
few-server deployment story. The specific technical premise for all three
adapters is stated directly: *"Disks have gotten fast enough that we don't
need RAM for as many tasks... [reaping] the simplification benefits of SSD
and NVMe drives being orders of magnitude faster than good-old spinning
rust."* Fewer accessory services isn't a minor convenience for 37signals'
deployment model — a Redis instance is one more piece to provision, secure,
back up, and pay for on every server, and on a single-box Kamal deployment
that overhead is proportionally much larger than it is on a large PaaS fleet
that already runs a managed Redis anyway.

### Solid Queue

Solid Queue is a database-backed Active Job backend. Its core mechanism,
confirmed directly from the gem's own README, is `SELECT ... FOR UPDATE SKIP
LOCKED` (available in PostgreSQL 9.5+, MySQL 8+, MariaDB 10.6+) so that
multiple worker processes can poll the same `solid_queue_ready_executions`
table concurrently without blocking each other on row locks:

```sql
-- Solid Queue's actual polling query (no queue filter)
SELECT job_id
FROM solid_queue_ready_executions
ORDER BY priority ASC, job_id ASC
LIMIT ?
FOR UPDATE SKIP LOCKED;
```

Three actor types do the work: **workers** pick ready jobs off that table and
run them (in a thread pool via `threads:`, or as fibers on a single reactor
thread via `fibers:` — mutually exclusive settings); **dispatchers** move
scheduled jobs whose time has come from `solid_queue_scheduled_executions`
into the ready table, and do concurrency-control maintenance; the
**scheduler** manages recurring tasks. A `supervisor` process forks and
monitors all of them (the default `fork` mode — `async` mode runs everything
in one process's threads instead, at the cost of isolation).

Recurring tasks are configured declaratively in `config/recurring.yml`:

```yaml
production:
  clear_stale_sessions:
    command: "Session.clear_stale"
    schedule: every day at 9am
  send_daily_digest:
    class: SendDailyDigestJob
    schedule: "0 8 * * *"
```

Concurrency controls (`limits_concurrency`) throttle how many jobs with a
given key run at once — this is a Solid Queue feature, distinct from the
idempotency and fan-out/fan-in *design patterns* covered in
[Background Jobs: Idempotency and Fan-Out](background-jobs-idempotency-and-fan-out.md):

```ruby
class DeliverAnnouncementToContactJob < ApplicationJob
  limits_concurrency to: 2, key: ->(contact) { contact.account }, duration: 5.minutes

  def perform(contact)
    # at most 2 of these run concurrently per account
  end
end
```

**Operationally versus Sidekiq**: there's no separate Redis process to
provision or fail over — the queue lives in the same database you're already
running (recommended as a separate logical database, but still no new
service). The real trade-off is polling versus push: Solid Queue's own
documented defaults are a `0.1` second polling interval for workers and `1`
second for dispatchers, which is the mechanism, not an approximation — a
worker picking up a freshly-enqueued job waits on that poll cadence, where a
Redis-backed queue with a blocking pop (`BRPOP`) can hand a job to a free
worker within milliseconds of enqueue. For most background work (sending an
email, processing a webhook, generating a report) that difference is
invisible; for a job whose whole point is sub-second reaction time, it's a
real, measurable latency floor that polling intervals alone don't erase.

### Solid Cache

Solid Cache is `ActiveSupport::Cache::Store` backed by a dedicated
`solid_cache_entries` table instead of Redis or Memcached. Per the gem's own
README, it is explicitly a **FIFO cache, not LRU**: eviction doesn't track
access recency at all — it estimates current size/count by comparing max and
min primary key IDs, and once a write pushes the tracked write-counter past
50% of `expiry_batch_size` (default 100), a background thread deletes the
oldest `expiry_batch_size` rows, first by whether `max_entries`/`max_size` is
exceeded, otherwise by `max_age` (default 2 weeks). Deleting from one end of
the table while inserting at the other avoids fragmentation. The trade for
giving up LRU precision is operational simplicity — no per-read bookkeeping,
and eviction only runs when the cache is actively being written to, so an
idle cache costs nothing.

```yaml
# config/cache.yml
production:
  database: cache
  store_options:
    max_age: <%= 60.days.to_i %>
    max_size: <%= 256.gigabytes %>
```

The latency trade-off is real and 37signals is explicit about the number:
moving Basecamp's cache to disk-backed Solid Cache made individual reads
**about 40% slower** than their prior Redis setup. What made this an
obviously good trade for them wasn't a magic disk-is-fast-enough trick — it
was that the cache became roughly **6x larger** at roughly **80% lower
storage cost**, which raised the hit rate enough that Basecamp's P95 request
duration fell from 375ms to 225ms. A slower cache that's hit far more often
beat a faster cache that's hit less often. This is a workload-dependent bet:
an app that's lightly cached to begin with won't see the same payoff, and per
Solid Cache's README, per-read latency still matters for that case — nothing
here waives the cache-store-latency reasoning covered in
[Russian Doll Caching](russian-doll-caching.md), which owns the strategy
question of *what* to cache and *how* to key it, not the storage engine
underneath.

Solid Cache also supports **encryption at rest**, real and directly
configurable — set `encrypt: true` in `config/cache.yml` (or
`config.solid_cache.encrypt = true`), on top of an app already configured for
Active Record Encryption. It uses a compression-disabled encryptor (the cache
already compresses) and a MessagePack serializer that stores roughly 40% more
data than the standard serializer, which matters because encrypted payloads
are stored in binary columns with real size limits.

### Solid Cable

Solid Cable is Action Cable's pubsub layer backed by a `solid_cable_messages`
table instead of Redis, using polling (default `0.1.seconds`) instead of
`PUBLISH`/`SUBSCRIBE`. The gem's own README states its performance target
plainly: *"Despite polling, the performance of Solid Cable is comparable to
Redis in most situations."* That claim is backed by benchmarks published in
the gem's own repo (k6 load test, SQLite, default 0.1s polling, 100 VUs):
average round-trip time ~136ms versus Redis's ~69ms on the same hardware — a
real, measurable gap, not "comparable" in the sense of identical, but small
enough not to matter for most UI-driven realtime features. That gap widens
under load: at 750 concurrent virtual users in the same benchmark, Solid
Cable's average RTT grew to ~548ms (Redis: ~163ms), and the gem's own docs
note that dropping the polling interval to `0.01s` brings SQLite "comparable
to Redis" again — at the cost of ten times the polling query volume against
the database.

Messages are retained and autotrimmed based on `message_retention` (default 1
day) — a side benefit is that recent broadcast history is queryable for
debugging, something Redis pubsub never gave you since it holds nothing after
delivery. Autotrimming itself has a documented cost: the README notes it "can
negatively impact performance slightly depending on your workload because it
is potentially doing a delete on broadcast," which is why `autotrim: false`
plus a scheduled `SolidCable::TrimJob` is offered as an alternative for
high-broadcast-volume apps.

### When to still choose Redis

None of the three adapters claim to be a universal replacement, and the
honest decision framework tracks the same axis in all three cases: **how
much does sub-second-to-millisecond latency, at meaningful concurrency,
actually matter for this specific workload** —

- **Solid Queue → Sidekiq/Redis**: reach for Redis-backed Sidekiq when jobs
  need to start within single-digit milliseconds of being enqueued at
  sustained high volume (real-time trading, live bidding), or when you're
  already running Redis for other reasons and the operational cost of a
  second queue system exceeds the cost of one more Redis client.
- **Solid Cache → Redis/Memcached**: reach for an in-memory store when the
  workload is read-latency-sensitive at the microsecond level rather than
  hit-rate-sensitive, or when the cached data churns so fast that a large
  retention window buys nothing (a FIFO eviction policy on a cache that
  never has "cold" entries worth keeping around isn't earning its keep).
- **Solid Cable → Redis (or AnyCable)**: Solid Cable's own benchmarks show
  the RTT gap widening as concurrent connections climb into the high
  hundreds; for genuinely high-throughput realtime (thousands of concurrent
  connections, many messages/second per connection, or sub-10ms delivery
  guarantees) the polling model is the wrong tool, and Redis pubsub (or a
  dedicated product like AnyCable) is the documented fallback.

The unifying signal: all three adapters trade a small, roughly-constant
latency tax (a polling interval, a slower individual disk read) for
operational simplicity and, in Solid Cache's case, a genuinely bigger
resource (cache size). That's a good trade until the tax itself becomes the
bottleneck — which for most CRUD-shaped Rails apps, it never does.

## Trade-offs

- **The transactional-integrity footgun**: Solid Queue's README calls this
  out directly. If the job database and the app database are the same
  connection, enqueuing a job inside an `ActiveRecord` transaction ties the
  job's existence to that transaction's commit/rollback — powerful, but easy
  to depend on silently. Move Solid Queue to its own database later (the
  recommended, default setup) and that guarantee evaporates with no error:
  ```ruby
  ApplicationRecord.transaction do
    order.update!(status: "paid")
    ChargeReceiptJob.perform_later(order.id) # enqueue rides the transaction...
    raise ActiveRecord::Rollback if suspicious?
    # ...until someone points Solid Queue at its own DB, at which point
    # ChargeReceiptJob may already have been enqueued and could run even
    # though the order update above got rolled back.
  end
  ```
  Rails 8's `enqueue_after_transaction_commit` (opt-in, off by default) fixes
  this properly instead of relying on incidental same-database behavior.
- **Solid Cache is FIFO, not LRU.** A frequently-read key that happens to be
  old can be evicted before a key nobody has touched in weeks just because
  it was written more recently. For a workload with a genuine "hot set"
  distinct from write-recency, this is a real correctness-of-intuition gap,
  even though it's the deliberate, documented design (recency tracking would
  cost a write on every read).
- **Concurrency controls have real overhead.** Solid Queue's own docs warn
  that `limits_concurrency` should not be used as a general throttle — each
  controlled job needs a semaphore row created and updated, and controlled
  jobs lose the performance benefit of bulk enqueuing (`perform_all_later`)
  entirely, since they must be enqueued one at a time to respect the limit.
  For simple rate-limiting (as opposed to true mutual-exclusion), a
  dedicated low-concurrency queue with fewer worker threads is the
  documented, cheaper alternative.
- **All three adapters add connection pool pressure**, on top of whatever
  the web tier already needs — workers, dispatchers, cache expiry threads,
  and Cable pollers each hold their own connections against whatever
  database backs them. Solid Queue's own guidance is to size a thread
  worker's `threads:` at or below the queue database's pool size minus 2;
  getting this wrong doesn't fail loudly, it shows up as intermittent
  `ActiveRecord::ConnectionTimeoutError` under load — see
  [Connection Pooling and PgBouncer](connection-pooling-and-pgbouncer.md)
  for the pool-sizing math this interacts with.
- **"Fewer moving parts" doesn't mean "one database."** The recommended
  setup for all three adapters is a *separate* logical database each (queue,
  cache, cable) — meaning a from-scratch Rails 8 app ships with four
  configured databases (primary + three), each with its own migration path
  and its own `database.yml` entry, and its own capacity/backup story.
  That's still fewer operational surfaces than Redis-plus-Sidekiq-plus-a-
  separate-pubsub-broker, but it's not zero new surface area either.

## Documentation Links

- [rails/solid_queue — README](https://github.com/rails/solid_queue) — doc
- [rails/solid_cache — README](https://github.com/rails/solid_cache) — doc
- [rails/solid_cable — README](https://github.com/rails/solid_cable) — doc
- [Rails 8.0: No PaaS Required — rubyonrails.org](https://rubyonrails.org/2024/11/7/rails-8-no-paas-required) — doc
- [Introducing Solid Queue — 37signals Dev](https://dev.37signals.com/introducing-solid-queue/) — doc
- [Solid Cache — 37signals Dev](https://dev.37signals.com/solid-cache/) — doc
- [Ruby on Rails 8.0 Release Notes — Rails Guides](https://guides.rubyonrails.org/8_0_release_notes.html) — doc

---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Background jobs fail, retry, and sometimes run twice — that's the normal
operating condition of any queue, not an edge case. Idempotency (a job
that's safe to run more than once), separating jobs by duration so slow
ones don't block fast ones, and choosing the right queue backend for the
workload are the three decisions that determine whether a job system stays
reliable under real production failure conditions.

## Use Cases

- Writing a job that's safe to run twice — the payment charged twice, the
  email sent twice, the duplicate-record bugs that come from queues
  retrying a job that actually succeeded but failed to acknowledge.
- Deciding whether to build a "run this only once" guarantee yourself with
  a database lock, versus trusting a queue library's built-in uniqueness
  feature.
- Splitting a mixed workload (some 100ms jobs, some 10-second jobs) into
  separate queues so the fast ones don't get stuck behind the slow ones.
- Choosing between a SQL-backed queue and a Redis-backed one when
  durability and throughput pull in different directions.

## Deep Dive

### Idempotency via a row lock, not a queue feature

```ruby
class ProcessRefundJob
  def perform(order_id)
    order = Order.find(order_id)
    order.with_lock do
      return if order.refund_processed?
      order.process_refund!
      order.update!(refund_processed: true)
    end
  end
end
```

`with_lock` takes a row-level database lock for the duration of the block,
making the "check, then act" sequence atomic even if the same job runs
concurrently (a retry racing the original attempt, say). This is a more
reliable idempotency guarantee than a queue library's built-in "unique
job" feature — those are generally best-effort, not something to depend on
when correctness genuinely matters (a duplicate charge). Reach for a queue
library's throttling features when the goal is actually rate-limiting, not
uniqueness — they're solving a different problem.

### Separate queues by job duration

```ruby
class TranscodeVideoJob
  include Sidekiq::Job
  sidekiq_options queue: "slow"
end

class SendWelcomeEmailJob
  include Sidekiq::Job
  sidekiq_options queue: "fast"
end
```

Mixing a 10-second video transcode and a 100ms email send in the same
queue means the email waits behind however many transcodes are ahead of
it — the fast job inherits the slow job's latency. Separate, appropriately
-sized worker pools per queue (more workers on `fast`, fewer on `slow`) fix
this without any change to the jobs themselves.

### Fan-out / fan-in: turning serial work into parallel work

```ruby
class GenerateReportJob
  def perform(report_id)
    item_ids = Report.find(report_id).item_ids
    item_ids.each { |id| GenerateItemStatsJob.perform_async(report_id, id) }
  end
end

class GenerateItemStatsJob
  def perform(report_id, item_id)
    ItemStats.compute_and_store(item_id)
    ReduceReportJob.perform_async(report_id) if Report.find(report_id).all_items_done?
  end
end
```

A three-stage pipeline — fan out per-item work, then fan back in once
everything's done — turns an O(n) serial job into O(n / worker_count),
bounded by however many workers are available. It costs real coordination
complexity (knowing when "all items done" is true) in exchange for that
parallelism.

### Choosing a queue backend

```
Sidekiq (Redis)  — cited at 20-25x the throughput of a Resque-style queue on
                    I/O-heavy work, via real threading. No ACID guarantees
                    from Redis itself.
Que (Postgres,
 advisory locks) — trades throughput for the ACID guarantees of the same
                    database your app data already lives in — a job enqueued
                    in the same transaction as the data it depends on either
                    both commit or neither does.
```

The queue's own datastore should live in the same datacenter as the
workers — the same network round-trip penalty (50-80ms) that applies to any
remote database applies here too, and shows up directly as job latency.

## Trade-offs

- **A queue library's "unique job" feature is best-effort, not a
  correctness guarantee** — for anything where a duplicate run is a real
  problem (charging money, sending an irreversible action), a database-level
  lock is the dependable mechanism, not a queue-level convenience flag.
- **A Redis-backed queue trades ACID guarantees for throughput; a
  Postgres-backed queue trades throughput for consistency with the rest of
  the app's data** — the right choice depends on whether job loss/duplication
  or job latency is the more expensive failure mode for that specific job.
- **`Timeout` (Ruby's standard-library timeout module) is unreliable for
  bounding a job's execution time** — it works by raising an exception into
  an arbitrary point of another thread's execution, which can leave things
  in an inconsistent state; a library or API's own native timeout option is
  the safer bound.

## Documentation Links

- [Active Job Basics — Rails Guides](https://guides.rubyonrails.org/active_job_basics.html) — doc
- [Sidekiq — Best Practices](https://github.com/sidekiq/sidekiq/wiki/Best-Practices) — doc
- [The Complete Guide to Rails Performance — Backgrounding Work](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc

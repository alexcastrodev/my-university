---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Guessing where a Rails app spends its time doesn't scale past a handful of
requests. `rack-mini-profiler` running in production (safely, behind auth)
and an APM with realistic response-time budgets are what turn "the app
feels slow" into a specific line of code or a specific query — the single
highest-leverage tool most Rails apps under-use is a profiler that's
actually running where the real data and real traffic live, not just in
development against a handful of seed rows.

## Use Cases

- Finding the actual query, template render, or memory allocation behind a
  slow page — not just knowing that the page overall is slow.
- Setting a realistic response-time budget for an APM to alert against,
  instead of an arbitrary threshold.
- Catching exceptions being silently raised and rescued during an
  otherwise-200-OK request — invisible to normal error tracking, but a real
  performance cost (see the Exceptions as Control Flow concept).
- Deciding when a slow endpoint's problem is actually external — a
  synchronous third-party API call that should be backgrounded and cached
  instead.

## Deep Dive

### rack-mini-profiler, safely, in production

```ruby
# app/controllers/application_controller.rb
before_action { Rack::MiniProfiler.authorize_request if params[:rmp] }

# config/initializers/mini_profiler.rb
Rack::MiniProfiler.config.storage = Rack::MiniProfiler::MemoryStore
```

Running the profiler only in development misses everything that only
shows up under real production data volume and real traffic patterns —
N+1s that don't appear with ten seed rows, template renders that only get
slow past a certain collection size. Gating it behind an explicit
`authorize_request` call (triggered by a query param only admins know)
keeps it safe to leave enabled in production. The default filesystem-based
storage is slow enough to skew the very measurements it's taking —
`MemoryStore` avoids that.

```
?pp=flamegraph        millisecond-by-millisecond flamegraph of the whole request
?pp=profile-memory     allocated vs. retained memory, per line of code
?pp=profile-gc         GC.stat delta across the request — catches abnormal allocation spikes
?pp=trace-exceptions   exceptions raised and silently rescued during a 200 OK request
```

The badge that appears on every page by default already surfaces the
first, fastest signal: SQL query count (more than 1-3 on a simple page is
worth investigating) and total time in SQL as a percentage of the request.

### APM response-time budgets that mean something

```
Server response time (HTML app):  < 100ms good · < 300ms okay · > 300ms slow
                                   (halve these thresholds for a JSON-only API)
Browser load time:                < 3s good · < 6s okay · > 6s slow
```

Server response time is typically only around 10% of what a user actually
experiences as page load time — an APM alert tuned only on server response
time misses the majority of what determines whether the page *feels*
slow. Requests-per-minute is a useful proxy for when scaling actually
matters: under ~10 req/min, one server is enough regardless of
optimization; past ~1000 req/min, the bottleneck has almost always moved
to a database or external cache, not "add another app server."

### Finding exceptions hiding inside 200 OK responses

```ruby
begin
  ExternalPricingAPI.fetch(sku)
rescue Timeout::Error
  fallback_price(sku)   # request still returns 200 — but an exception was raised
end
```

A request can return `200 OK` while having raised and rescued an
exception somewhere along the way — invisible to error trackers (nothing
was reported as an error) but still paying the real cost of exception
handling (see the Exceptions as Control Flow concept for why that cost is
measurable). `?pp=trace-exceptions` is the tool that surfaces this pattern
specifically, which nothing else in a typical monitoring stack catches.

## Trade-offs

- **Filesystem-based profiler storage is slow enough to distort the
  measurements it's taking** — always switch to `MemoryStore` (or an
  equivalent) before trusting profiler numbers gathered under real load.
- **Server-side response time alone is a misleading proxy for user-
  perceived speed** — an APM alert tuned only on it will miss front-end-
  dominated slowness (see the front-end/network concepts in this track for
  what dominates the other ~90%).
- **A GC statistics dashboard from an APM is generally not reliable for a
  multi-process, multi-threaded deployment** (Puma clustered, Sidekiq) —
  `rack-mini-profiler` combined with `memory_profiler` is the more trustworthy
  source for memory-specific questions in that setup.

## Documentation Links

- [rack-mini-profiler — GitHub](https://github.com/MiniProfiler/rack-mini-profiler) — doc
- [The Complete Guide to Rails Performance — rack-mini-profiler & Performance Monitoring with New Relic](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc

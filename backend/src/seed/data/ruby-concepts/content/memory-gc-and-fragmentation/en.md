---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

Ruby's memory model has one property that explains almost every "why is my
process using so much RAM" question: **the MRI heap never shrinks back down
after a spike**. A process that briefly needs 350MB to render one big page
stays at roughly that size afterward, even though almost none of that memory
is in use anymore. Telling that apart from a genuine memory leak — and
knowing what's actually available to fix each one — is the core skill this
concept covers.

## Use Cases

- Deciding whether a process that grew from 100MB to 350MB after a big
  request is a problem (leak) or expected behavior (bloat) before paging
  anyone about it.
- Diagnosing a slow, steady RSS climb that never restarts — is it a Ruby
  object leak, or a C-extension/VM leak invisible to `GC.stat`?
- Deciding whether a multithreaded, I/O-heavy Ruby process (Puma, Sidekiq)
  would benefit from jemalloc, and why that specific combination matters.
- Knowing when (rarely) it's actually worth tuning `RUBY_GC_HEAP_*`
  environment variables instead of leaving GC defaults alone.

## Deep Dive

### Bloat vs. leak: the diagnostic model

```ruby
# A single big allocation permanently grows the process, even after GC:
arr = Array.new(1_000_000) { "string" }
arr = nil
GC.start
# RSS recovers only a small fraction of what it grew by
```

Ruby's heap is made of fixed-size pages; a page with even one live object on
it ("eden") can't be returned to the OS, only a fully-empty page ("tomb")
can. A big transient allocation leaves a lot of half-empty eden pages behind
— the process looks permanently larger even though `GC.start` genuinely
collected the garbage. This is **bloat**: fast, large, one-time, and it
plateaus within a few hours of normal traffic.

A **leak** looks different: slow, linear growth that never plateaus, even
after 24+ hours with worker restarts disabled. The diagnostic split:

```ruby
# Watched over time in a long-running process:
GC.stat[:heap_live_slots]
```

- `heap_live_slots` growing without bound → a real Ruby object leak
  (something keeps a reference alive that shouldn't — a growing cache with
  no eviction, an array appended to but never cleared).
- `heap_live_slots` stays flat but RSS keeps climbing → the leak is in a
  **C-extension or the VM itself**, invisible to Ruby-level GC stats
  entirely. This is rarer but much harder to track down — it usually needs
  `jemalloc`'s own leak profiler (`MALLOC_CONF=prof_leak:true,...`) or a
  full heap dump, and can take real investigation time.

### Thread-arena fragmentation: the advanced case

```
MALLOC_ARENA_MAX=2 ruby app.rb
```

glibc's malloc (Ruby's default allocator on Linux) gives each thread its own
memory arena to reduce lock contention — normally up to `8 × number of
cores`. Arenas can't share free memory with each other, which fragments
badly in one specific combination: a process that is **both multithreaded
and I/O-heavy** (Puma, Sidekiq) — because the GVL only allows real
contention between threads while one of them is blocked on I/O, which is
exactly when this fragmentation shows up. Reported real-world numbers: 2-4x
higher RSS in that specific setup, fixable with `MALLOC_ARENA_MAX=2` (~40%
memory reduction, ~13% CPU cost) or, more cleanly, by switching the
allocator entirely.

### jemalloc as a structural fix

```
# Linux, no Ruby recompile needed:
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so ruby app.rb
```

jemalloc's arena design avoids the glibc fragmentation problem by
construction rather than just capping it. It's a near risk-free change to
try — worst case it's a wash; best case (Puma/Sidekiq specifically) it's a
meaningful, structural memory win without the ~13% CPU trade-off that
`MALLOC_ARENA_MAX` carries.

## Trade-offs

- **Tuning `RUBY_GC_HEAP_*` env vars is very rarely worth it** — most apps
  spend under 1% of CPU time in GC. It only pays off in two narrow cases:
  momentary memory-pressure spikes leaving hundreds of thousands of
  permanently-free slots (lower the growth ratios, fix `INIT_SLOTS` at
  observed steady-state), or an app that's provably CPU-bound in GC (do the
  opposite — trade memory for less-frequent collection). Always confirm
  with `GC.stat` before touching any of these; guessing wastes the tuning
  effort.
- **`MALLOC_ARENA_MAX=1`** looks like the maximally-aggressive fix but isn't
  worth it — it buys only 1-2% more memory savings over `=2`, for a
  disproportionate CPU cost. `2`-`4` is the practical range.
- **jemalloc/tcmalloc show a real ~15% win on synthetic GC-stress
  benchmarks, but a small and inconsistent one under real request traffic**
  — treat it as a safe, cheap experiment worth running on any multithreaded
  production app, not a guaranteed fixed percentage.

## Documentation Links

- [GC — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/GC.html) — doc
- [ObjectSpace — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/ObjectSpace.html) — doc
- [The Complete Guide to Rails Performance — Memory Leaks & Memory Fragmentation](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc

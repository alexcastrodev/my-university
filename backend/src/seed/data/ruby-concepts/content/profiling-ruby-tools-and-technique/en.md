---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Most Ruby performance work goes wrong in the same two ways: measuring the
wrong thing, and measuring the right thing in the wrong place. A profiler
answers "where does the time actually go in this program"; a benchmark
answers "which of these two snippets is faster in isolation" — and the second
question routinely has an answer that doesn't change the first. This concept
covers the profiling toolkit (`ruby-prof`, `stackprof`) and the memory
toolkit (`ObjectSpace`, `derailed_benchmarks`, `memory_profiler`), the
measurement bias each one carries, and the discipline of validating a
micro-benchmark win at the macro level before believing it.

## Use Cases

- Finding the actual hot spot in a slow test suite, a boot sequence, or a
  library — code that lives outside the request/response cycle, where a
  2-3x-overhead tracing profiler is perfectly acceptable.
- Profiling something in production without wrecking latency, and knowing
  which timing mode to pick so `sleep`, network I/O, or a noisy neighbor
  process doesn't silently distort the result.
- Auditing why a fresh Rails process already costs 200MB before serving a
  single request — which gem in the Gemfile is paying for that at `require`
  time.
- Telling apart "everything this request allocated" from "what this request
  left behind", which is the only distinction that matters when hunting a
  leak.
- Deciding whether a 12x micro-benchmark win is worth shipping at all.

## Deep Dive

### ruby-prof: tracing, and the three measurement modes

`ruby-prof` instruments **every method call**. That gives exact call counts
and a full call graph, at 2-3x runtime overhead — never in production, but
ideal for a test suite, a boot profile, or a library benchmark.

```ruby
require "ruby-prof"

RubyProf.measure_mode = RubyProf::PROCESS_TIME

result = RubyProf.profile do
  1_000.times { Order.new(items: items).total }
end

RubyProf::FlatPrinter.new(result).print($stdout, min_percent: 1)
```

The measurement mode is not a detail — each one has a specific bias:

- **`CPU_TIME`** counts clock cycles, not elapsed time. A method that does
  `sleep 5` or waits on a socket shows up as ~0ms, because it burns no CPU.
  It's also distorted by CPU frequency scaling (a thermally throttled laptop
  reports different numbers for identical work), and it is documented as
  buggy on the macOS kernel specifically.
- **`WALL_TIME`** (via `gettimeofday`) is the most commonly used mode and
  the most intuitive — but it measures everything that happened, including
  network and disk latency you don't control and CPU time stolen by other
  processes on the machine. Run a profile while a build is compiling in
  another terminal and the numbers change.
- **`PROCESS_TIME`** (via `clock()`) measures time consumed by this process
  only, so it's immune to other processes on the box. Its blind spot is
  subprocesses: anything done via `fork`/`spawn` isn't counted. Where it's
  available, it's generally the best default.

### stackprof: sampling, and safe in production

```ruby
require "stackprof"

StackProf.run(mode: :wall, out: "tmp/stackprof-orders.dump", interval: 1000) do
  100.times { OrderReport.new(shop).generate }
end
```

```
$ stackprof tmp/stackprof-orders.dump --text --limit 10
```

`stackprof` (Ruby 2.1+) doesn't instrument calls — it interrupts the process
on a timer and records the stack. Overhead is low enough to run against live
traffic, which makes it the only one of the two you can point at real
production behavior. It's the engine underneath `rack-mini-profiler`; the
Rails-side usage of that tool (the `?pp=` query params, running it safely
behind auth) belongs to the **Production Observability** concept, not here.
Its `:cpu` timing mode carries the same macOS bug as `ruby-prof`'s
`CPU_TIME` — on a Mac, prefer `:wall`.

### Reading the output: start at the highest %self

Both tools report `%self` (time spent inside a method, excluding its
callees) alongside `%total` (including callees). `%total` at the top of the
report is almost always something useless like `Integer#times` or the
controller action — it contains everything. **`%self` is where the work
actually happens.** The practical rule is: sort by `%self`, take the top
entry, optimize it, re-profile, repeat. Optimizing top-down by `%self`
guarantees you're spending effort where the time is, instead of on whatever
code looked suspicious.

### Benchmark is not a profile

A benchmark compares isolated alternatives:

```ruby
require "benchmark/ips"

arr = (1..10_000).to_a

Benchmark.ips do |x|
  x.report("sort_by rand") { arr.sort_by { rand } }
  x.report("shuffle")      { arr.shuffle }
  x.compare!
end
```

That comparison is real and reproducible — `shuffle` came out roughly **12x
faster** than `sort_by { rand }` in the book's own measurement. And when the
author applied the change to the real test suite where that line lived, the
suite's total runtime **did not measurably move**.

Nothing was wrong with the benchmark. The mistake was assuming that "faster
in isolation" implies "faster in the program", which only holds if that code
is a meaningful share of total time. It wasn't. `benchmark-ips` answers
*which alternative is faster*; a profile answers *whether this code matters
at all*. The working order is: profile first to find what's actually hot,
benchmark alternatives for that specific spot, then **re-profile the whole
program** to confirm the win survived at the macro level. A micro-benchmark
win that doesn't show up in end-to-end numbers is not a win — it's a change.

### Live memory introspection: ObjectSpace and GC::Profiler

```ruby
ObjectSpace.count_objects
# => {:TOTAL=>62108, :FREE=>1289, :T_OBJECT=>1723, :T_STRING=>28451, ...}

require "objspace"
ObjectSpace.count_objects_size          # bytes per object type
ObjectSpace.memsize_of("a" * 100_000)   # size of one specific object
ObjectSpace.memsize_of_all(String)      # total bytes held by all Strings
```

`ObjectSpace.count_objects` is built in and costs nothing when you're not
calling it — safe to expose behind an admin endpoint. The `objspace` library
is different: `require "objspace"` turns on heavier allocation tracing, so
the size-aware methods above are development tools, not production ones.

`GC::Profiler` records timing for every GC run:

```ruby
GC::Profiler.enable
run_the_workload
GC::Profiler.report   # prints per-GC invoke time, heap size, slot counts
GC::Profiler.disable
```

Its overhead is high — enable it around a specific workload in development,
never leave it on.

### gc_tracer: GC.stat over time

`gc_tracer` (Koichi Sasada) logs the full `GC.stat` snapshot on an ongoing
basis rather than at a single point. In a Rack app it's a middleware:

```ruby
require "rack/gc_tracer"
use Rack::GCTracerMiddleware, view_page_path: "/gc_tracer", filename: "log/gc"
```

That exposes a page with `GC.stat` logged per request. For background jobs,
where there's no Rack cycle to hook, wrap the work directly:

```ruby
require "gc_tracer"
GC::Tracer.start_logging("log/gc-job.log") do
  ImportJob.perform_now(batch)
end
```

### derailed_benchmarks: static gem audit, then dynamic

The static side doesn't boot your app at all — it `require`s each gem in the
Gemfile and measures what that alone costs:

```
$ bundle exec derailed bundle:mem
TOP: 54.3 MiB
  mime-types: 19.9 MiB
    mime-types/columnar: 1.9 MiB
  actionpack: 8.5 MiB
  ...
```

The `TOP` figure is the whole point: it should land somewhere around
**50-60MB**. Much higher means a single gem is charging you memory in every
worker, forever, before a request is served. The book's classic case is
right there in the output above — `mime-types` before 2.6 cost an extra
15-30MB, fixed without dropping the gem:

```ruby
gem "mime-types", ">= 2.6", require: "mime/types/columnar"
```

Another recurring one: `carrierwave` pulls in `fog` (~10MB); swapping to
`carrierwave-aws` gets the same functionality without that dependency.

The dynamic benchmarks do hit the real running app:

```
$ PATH_TO_HIT=/products TEST_COUNT=5000 bundle exec derailed exec perf:mem_over_time
$ PATH_TO_HIT=/products TEST_COUNT=100  bundle exec derailed exec perf:objects
```

`perf:mem_over_time` prints RSS repeatedly while hammering one endpoint, and
the **shape** of that series is the answer: memory that climbs fast and then
plateaus is bloat — expected, and covered by the bloat-vs-leak model in the
**Memory, GC, and the Bloat vs. Leak Model** concept. Memory that keeps
growing linearly with no plateau after thousands of requests is a leak.
`perf:objects` then shows which allocations are behind it.

### memory_profiler: allocated vs. retained

```ruby
require "memory_profiler"

report = MemoryProfiler.report do
  ProductsController.action(:index).call(env)
end

report.pretty_print(to_file: "tmp/memprof.txt")
```

```
Total allocated: 12.4 MB (148213 objects)
Total retained:   1.9 MB (4021 objects)
```

The two totals answer different questions. **Allocated** is everything that
passed through memory during the block, including objects the GC already
collected — high allocation costs CPU (more GC runs) but doesn't necessarily
grow the process. **Retained** is what's still alive after the block ends,
and that is the number that matters for leaks: a request that retains
objects every time it runs is a leak, no matter how modest its allocation
count. The report breaks both down by gem, file, and line, so a retained
number points at a specific line. Unlike pure `GC.stat` inspection,
`memory_profiler` also works with C-extensions.

## Trade-offs

- **Tracing vs. sampling is a placement decision, not a quality one.**
  `ruby-prof` gives exact call counts and a complete call graph, which is
  what you want for a test suite or boot profile where 2-3x overhead is
  free. `stackprof` gives a statistical picture with no exact counts, which
  is the only thing safe to run under production traffic. Trying to force
  `ruby-prof` into a production request path is the common mistake; so is
  concluding from a low-sample stackprof run that a method "isn't called".
- **Every timing mode lies about something — pick the lie you can live
  with.** `CPU_TIME` hides all I/O wait (an HTTP-bound method looks free);
  `WALL_TIME` includes noise from unrelated processes; `PROCESS_TIME` misses
  subprocesses. On macOS the CPU-based modes are additionally unreliable at
  the kernel level in both tools, so `WALL_TIME`/`:wall` is often the only
  honest option there — just profile on a quiet machine.
- **Memory tooling splits cleanly into "always safe" and "dev only".**
  `ObjectSpace.count_objects` and `GC.stat` cost nothing until called;
  `require "objspace"`, `GC::Profiler`, and `memory_profiler` all add real
  tracing overhead. Reaching for the heavy tools first is tempting and
  usually unnecessary — the cheap ones answer the "is anything even wrong"
  question.
- **A micro-benchmark win is a hypothesis, not a result.** The 12x
  `shuffle` case is the cautionary example: correct measurement, real
  speedup, zero effect on the program. Always close the loop with a macro
  measurement of the whole run; if total time didn't move, revert the
  complexity you added and go back to the profile.
- **Static gem audits are cheap and unusually high-leverage.** `derailed
  bundle:mem` runs in seconds, needs no traffic, and its findings apply to
  every worker on every machine permanently — but it only sees `require`-time
  cost. A gem that's lean to load and wasteful per request is invisible to
  it, which is what the dynamic benchmarks and `memory_profiler` are for.

## Documentation Links

- [ruby-prof](https://github.com/ruby-prof/ruby-prof) — doc
- [stackprof](https://github.com/tmm1/stackprof) — doc
- [memory_profiler](https://github.com/SamSaffron/memory_profiler) — doc
- [derailed_benchmarks](https://github.com/schneems/derailed_benchmarks) — doc
- [ObjectSpace — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/ObjectSpace.html) — doc
- [The Complete Guide to Rails Performance — Profiling and Memory](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc

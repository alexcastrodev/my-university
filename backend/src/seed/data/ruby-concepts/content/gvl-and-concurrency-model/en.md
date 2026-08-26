---
version: 1.0
updatedAt: 2026-08-17
---
## Objective

MRI (the standard Ruby interpreter) has a Global VM Lock (GVL, historically called
GIL): only one thread executes Ruby bytecode at a time, even on a multi-core
machine. Threads still give you real concurrency for I/O-bound work, because the
GVL is released around blocking I/O calls — but they never give you CPU
parallelism. Ractors (Ruby 3.0+) are the one mechanism in MRI that actually runs
Ruby code on multiple cores at once, at the cost of a much stricter isolation
model than threads.

## Use Cases

- Deciding whether a slow task should be a thread (I/O-bound: HTTP calls, DB
  queries, file reads) or needs real parallelism (CPU-bound: image processing,
  heavy computation) — threads help with the former, not the latter, in MRI.
- Sizing a web server's thread pool (e.g. Puma) — more threads only helps up to
  the point where the workload is genuinely I/O-bound; past that, threads
  contend for the same GVL with no throughput gain.
- Recognizing a classic threading bug: variables captured from the enclosing
  scope (not passed as thread arguments) are shared, unsynchronized state.
- Considering Ractors for CPU-bound parallel work inside a single Ruby process,
  instead of reaching for multiple OS processes.

## Deep Dive

### The GVL: concurrency, not parallelism

```ruby
require "benchmark"

def cpu_work
  1_000_000.times { |i| i * i }
end

Benchmark.bm do |x|
  x.report("1 thread")  { 4.times { cpu_work } }
  x.report("4 threads") { 4.times.map { Thread.new { cpu_work } }.each(&:join) }
end
```

On MRI, the 4-thread version isn't meaningfully faster than the 1-thread version
for this CPU-bound loop — the GVL means only one thread's bytecode runs at a time,
so four threads doing pure computation take roughly the same total CPU time as
one thread doing it four times over, just interleaved. Swap `cpu_work` for
`sleep(0.1)` or a real HTTP call and the threaded version *does* win, because the
GVL is released while a thread is blocked on I/O.

### The classic shared-variable bug

```ruby
threads = [1, 2, 3].map { |i| Thread.new { puts i } }
threads.each(&:join)
```

Here `i` is passed as a block argument that becomes a value captured once per
`Thread.new` call — safe. The bug shows up when a variable from the *enclosing
scope* is read inside the thread body without being passed in:

```ruby
results = []
[1, 2, 3].each do |i|
  Thread.new { results << i * i }   # `i` here is the shared loop variable
end
```

Depending on scheduling, this can read a stale or already-advanced value of `i`
from the outer scope, because that `i` is one shared local, not one per thread.
Passing it explicitly (`Thread.new(i) { |local_i| ... }`) fixes it by giving each
thread its own copy at creation time.

### Ractors: real parallelism, real isolation

```ruby
ractors = 4.times.map do
  Ractor.new { 1_000_000.times.sum { |i| i * i } }
end
ractors.map(&:join)  # Ruby 4.0+: #join waits for completion, doesn't collect a value
```

Each Ractor has its own GVL, so CPU-bound work genuinely runs in parallel across
cores. The cost is isolation: a Ractor's block cannot see local variables or
globals from outside it — only what's explicitly passed in as an argument, or
objects made shareable (frozen, or otherwise immutable) via
`Ractor.make_sharable`. Communication between Ractors happens only through
explicit message passing, never through shared mutable state.

> ⚠️ **API note (Ruby 4.0+):** older Ractor examples you'll find online use
> `Ractor.yield(value)` inside the Ractor and `another_ractor.take` outside it —
> both were **removed in Ruby 4.0**. The current API uses `Ractor::Port` for
> explicit message ports, combined with `Ractor#join`/`Ractor#value` to wait for a
> Ractor's result. Check the `Ractor` docs for the Ruby version you're actually
> running before copying an older example.

## Trade-offs

- **Threads cost almost nothing to reach for, but only pay off for I/O-bound
  work** — reaching for `Thread.new` around a CPU-heavy loop is a common
  performance dead end in MRI specifically (JRuby, with no GVL, doesn't have this
  limitation — see the JRuby concept for that trade-off).
- **Ractors buy real parallelism at the cost of the isolation model** — no
  shared mutable state means existing code that closes over instance variables
  or globals generally can't be dropped into a Ractor unchanged; it has to be
  restructured around explicit message passing.
- **A mutex protects shared mutable state between threads, but it's easy to
  forget one** — `Thread::Mutex#synchronize` is the safe default because it
  guarantees unlock even if the block raises:
  ```ruby
  mutex = Thread::Mutex.new
  counter = 0
  10.times.map { Thread.new { mutex.synchronize { counter += 1 } } }.each(&:join)
  counter # => 10, reliably
  ```

## Documentation Links

- [Ractor — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Ractor.html) — doc
- [Thread — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Thread.html) — doc
- [Ruby 4.0.0 Released — ruby-lang.org (Ractor::Port API change)](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) — doc
- [The Complete Guide to Rails Performance — Webservers and I/O models](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc

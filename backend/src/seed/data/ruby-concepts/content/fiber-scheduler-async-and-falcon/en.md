---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Ruby ships the `Fiber::Scheduler` interface and stops there — the moment you
actually install an implementation, the picture changes completely. The `async`
gem is that implementation in production, and Falcon is a web server built on
top of it. Together they let you write code that *looks* like ordinary blocking
Ruby — no callbacks, no promise chains, no `.then` — while every blocking call
quietly yields the OS thread to another fiber. This concept is about what that
buys you day to day, how Falcon turns it into a request-serving architecture,
and the honest comparison against the thread-per-request model you already know
from Puma.

## Use Cases

- A service whose request handler fans out to five slow upstream APIs and
  spends 90% of its wall-clock time waiting on sockets.
- Long-lived connections at high count: WebSockets, Server-Sent Events, long
  polling, streaming responses — thousands of connections that are idle most of
  the time.
- A crawler, scraper, or bulk API client that wants a few thousand requests in
  flight with a hard cap on how many hit any one host.
- A proxy, gateway, or aggregator: high connection count, near-zero CPU per
  request, where thread-per-request means paying for a thread stack per idle
  socket.
- Deciding whether the answer to "we need more concurrent requests per process"
  is *raise Puma's thread count* or *change the concurrency unit entirely*.
- Applying a timeout or a concurrency limit across a whole group of in-flight
  operations, without threading a deadline through every method call.

## Deep Dive

### What an installed scheduler actually does to your code

`Async { }` creates a reactor on the current thread and installs its scheduler
for the duration of the block. From that point on, ordinary blocking operations
inside non-blocking fibers — socket reads and writes, `sleep`, DNS resolution,
waiting on a `Thread::Queue` or a `Thread::Mutex`, `Process.wait` — go through
the scheduler's hooks instead of parking the thread. The scheduler suspends that
fiber, runs whichever other fiber is ready, and resumes the first one when its
I/O is actually ready.

The visible consequence is that there is nothing to see. The code is the same
code:

```ruby
require "async"

Async do
  3.times do |i|
    Async do
      sleep(3 - i)              # yields to the scheduler; the thread is not blocked
      puts "task #{i} finished"
    end
  end
end
# task 2 / task 1 / task 0, total elapsed ~3s — not 6s
```

Three `sleep` calls that would serialize to six seconds overlap into three,
without a single line of asynchronous plumbing. `sleep` is the honest demo
because it makes the point unmistakable, but the same holds for every socket the
`async` ecosystem's I/O layer touches.

Nested `Async { }` starts a **child task**, not a new reactor. A task is a
non-blocking fiber with a result:

```ruby
require "async"
require "async/http/internet"

URLS = ["https://example.com/a", "https://example.com/b", "https://example.com/c"]

Async do
  internet = Async::HTTP::Internet.new

  tasks = URLS.map do |url|
    Async do
      response = internet.get(url)
      begin
        response.read
      ensure
        response.close
      end
    end
  end

  bodies = tasks.map(&:wait)   # each `wait` returns the task's value
  puts bodies.map(&:bytesize).inspect
ensure
  internet&.close
end
```

`Async::Task#wait` returns the block's value, or re-raises the exception the task
died with — deliberately the same contract as `Thread#value`. That symmetry is
the point: the mental model you already have for threads transfers, while the
cost model underneath does not.

### Structured concurrency: tasks form a tree

Tasks are not free-floating. A child task belongs to the task that created it,
and the enclosing `Async` block does not return until its children have
finished. If the parent is stopped or raises, the subtree is stopped with it.
That eliminates the leaked-background-work failure mode that plain
`Thread.new`-and-forget invites — there is no way to "forget" a task while its
parent is still on the stack.

For bounded concurrency, `async` gives you a semaphore and a barrier rather than
a thread pool. A fiber is cheap enough that the temptation is to spawn one per
work item; the limit you actually need is usually the *remote* system's, not
Ruby's:

```ruby
require "async"
require "async/barrier"
require "async/semaphore"

Async do
  barrier   = Async::Barrier.new
  semaphore = Async::Semaphore.new(10, parent: barrier)   # at most 10 in flight

  urls.each do |url|
    semaphore.async { fetch(url) }
  end

  barrier.wait     # all queued work is done (or one of them raised)
ensure
  barrier.stop     # on any exception, cancel whatever is still running
end
```

Timeouts are expressed on the task rather than per-call, so one deadline covers
everything that happens inside it:

```ruby
Async do |task|
  task.with_timeout(5) do
    internet.get(slow_url).read
  end
rescue Async::TimeoutError
  fallback_payload
end
```

### Falcon: the same model, running a web server

Falcon is a Rack-compatible application server built on `async` and
`async-http`. It speaks HTTP/1, HTTP/2, and TLS natively — no separate
terminating proxy required for those — and it runs **one fiber per request**
inside a reactor, with worker *processes* used only to reach across CPU cores.

Your app does not change shape; it is still a Rack app:

```ruby
# config.ru
run ->(env) { [200, {"content-type" => "text/plain"}, ["hello"]] }
```

```bash
bundle add falcon
bundle exec falcon serve --bind http://localhost:9292
```

The architectural difference is entirely in what a "concurrency unit" costs.
Under Puma, an in-flight request occupies a thread for its whole lifetime.
The GVL is released during I/O — see the GVL concept — so other threads *do*
make progress, but the waiting request still owns a thread and its stack the
entire time it waits. Concurrency is capped at your thread count, and raising
that count costs memory per thread whether or not the thread is doing anything.

```
Puma, 4 workers x 16 threads    → 64 concurrent requests, hard ceiling.
                                  A 500ms upstream call holds one of those 64
                                  slots for 500ms, doing nothing.

Falcon, 4 workers x 1 reactor   → thousands of concurrent requests. A request
                                  waiting on an upstream call holds a suspended
                                  fiber, and the reactor serves others.
```

Fibers are userspace: switching between them is a stack swap inside the
interpreter, with no kernel context switch and no GVL handoff, and their stacks
are far smaller and lazily grown compared to an OS thread's. That is why "ten
thousand idle connections" is an ordinary number for a fiber server and an
absurd one for a thread-per-request server.

### The state model shifts from thread to fiber

This is the migration detail that bites, and it follows directly from the fibers
concept: `Thread.current[]` is fiber-local. Under Puma, per-request state stored
against the thread works because a request *is* a thread. Under Falcon, many
requests share one thread, and each is its own fiber — so anything keyed by
thread is now shared across concurrent requests, and anything keyed by fiber is
invisible where you expected it.

Rails addresses this with an explicit knob: `ActiveSupport::IsolatedExecutionState`
and `config.active_support.isolation_level`, which a fiber-based server sets to
`:fiber` so that request-scoped state and ActiveRecord connection checkout track
the fiber rather than the thread. The corollary is a capacity question rather
than a correctness one: if each request checks out a database connection, then
concurrency is bounded by the connection pool no matter how many fibers you can
create. Fibers move the bottleneck; they do not delete it.

### When this is the right engineering choice

The honest test is the shape of the workload, not novelty:

- **Yes** when wall-clock time is dominated by waiting on other people's
  sockets, or when connection count is high and per-connection CPU is low.
- **Probably not** when the app is ordinary Rails CRUD against a fast local
  database. Puma's thread pool already covers that, and the ecosystem around it
  — APM agents, profilers, middleware, operational folklore — is far more
  battle-tested.
- **No** when the work is CPU-bound. Nothing here creates parallelism; you still
  need processes for cores, and see the trade-offs below for why CPU work is
  actively *worse* under a cooperative scheduler.

The prerequisite check is the dependency chain: every gem on the request path
must either use Ruby-level I/O (which the scheduler hooks) or explicitly support
the scheduler. A C extension that blocks on a socket internally, without going
through Ruby's I/O layer, blocks the whole reactor — not just its own request.
Verify the drivers you depend on before committing to the architecture.

## Trade-offs

- **Cooperative means no preemption, and one greedy fiber stalls everything.**
  Under Puma, a request doing heavy CPU work is timesliced by the GVL, so other
  threads still get turns. Under a reactor, a fiber that computes for 200ms
  without touching I/O simply does not yield, and every other request on that
  worker waits.
  ```ruby
  Async do
    Async { 50_000_000.times { |i| i * i } }   # no I/O → never yields
    Async { puts "starved until the loop above finishes" }
  end
  ```
- **Fiber-safety is a stricter bar than thread-safety in one specific way.**
  Code that stored request state in `Thread.current[]` and was correct under
  Puma is not automatically correct here — the same thread now serves many
  concurrent requests. Use the framework's isolation setting
  (`config.active_support.isolation_level = :fiber` on Rails) instead of
  auditing every call site by hand.
- **Cheap concurrency units do not create cheap resources.** Ten thousand
  fibers each wanting a database connection just relocates the queue to the
  connection pool — and the same applies to file descriptors, upstream rate
  limits, and memory held by in-flight request bodies. Bound the fan-out with
  `Async::Semaphore` rather than assuming the reactor will sort it out.
- **One unhooked C extension can negate the whole design.** A native driver that
  blocks without cooperating with the scheduler blocks the OS thread, which
  means it blocks every other fiber in that worker. This is usually the real
  blocker to adoption, not the application code.
- **It buys concurrency, never parallelism.** A single reactor is a single
  thread running Ruby. Falcon still runs multiple worker processes to use
  multiple cores, exactly as clustered Puma does.
- **The operational ecosystem assumes threads.** Profilers and APM agents that
  attribute work per thread, middleware that keys off thread identity, and
  stack traces that stop at a fiber boundary all get less useful. Budget for
  worse observability than the Puma path gives you.
- **Adopt it through a framework, not by hand.** `Fiber.set_scheduler` with a
  scheduler you wrote yourself is a genuine option and almost never the right
  one. Running Falcon, or wrapping a batch job in `Async { }`, gets you a tested
  scheduler and a maintained I/O stack; a hand-rolled scheduler gets you a new
  category of bug.

## Documentation Links

- [Falcon — a fiber-based web server for Ruby (GitHub)](https://github.com/socketry/falcon) — doc
- [Falcon — Getting Started guide](https://socketry.github.io/falcon/guides/getting-started/index.html) — doc
- [Fiber — Ruby Core docs (Fiber::Scheduler)](https://docs.ruby-lang.org/en/3.3/Fiber.html) — doc
- [async — GitHub (socketry)](https://github.com/socketry/async) — doc

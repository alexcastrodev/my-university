---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Knowing that MRI threads give you concurrency but not parallelism is only half
the story — the other half is coordinating them correctly. This concept covers
the primitives you actually reach for once threads exist: waiting for results
with `join` and `value`, per-thread state, the way an exception inside a thread
disappears until you collect it, `Thread::Mutex` beyond the basic
`synchronize` block (`try_lock` and non-blocking patterns), driving external OS
processes, and `Fiber` — cooperative coroutines that yield control only when
your own code asks them to.

## Use Cases

- Fanning out N HTTP calls in threads and collecting their return values, rather
  than just their side effects.
- Debugging a background thread that "silently did nothing" — the exception was
  raised and swallowed, waiting for a `join` that never came.
- Carrying request-scoped context (request id, current user, tenant) alongside a
  thread without threading it through every method signature.
- Guarding a periodic refresh or an expensive rebuild so that exactly one thread
  does the work and the rest move on instead of queuing up behind a lock.
- Shelling out to an external command — a migration script, `ffmpeg`, a linter —
  and deciding between blocking, non-blocking, and bidirectional pipes.
- Generating a potentially infinite sequence on demand, keeping producer logic
  separate from consumer logic.

## Deep Dive

### Collecting results: `join`, `value`, and the exit trap

`Thread#join` blocks the caller until the thread finishes and returns the thread
object. `Thread#value` does the same wait but returns the value of the thread
block's last expression — which is what you usually want when the thread is
computing something rather than mutating something.

```ruby
urls = ["https://example.com/a", "https://example.com/b"]

bodies = urls.map { |url| Thread.new(url) { |u| fetch(u) } }.map(&:value)
# => ["...body a...", "...body b..."]
```

`join` accepts an optional timeout in seconds and returns `nil` if the thread is
still running when it expires — useful for putting a ceiling on a straggler:

```ruby
t = Thread.new { slow_report }
if t.join(5).nil?
  t.kill          # last resort: no unwinding guarantees for the thread's work
  warn "report timed out"
end
```

Without a `join`/`value` anywhere, the process can reach the end of the main
thread and exit, taking every other thread with it mid-flight. Threads are not
daemonized-and-awaited like some runtimes; the main thread ending is the end of
the program.

```ruby
Thread.new { sleep 0.1; puts "never printed" }
# main thread ends here → interpreter exits → thread is killed
```

### Exceptions inside a thread are deferred, not lost

An uncaught exception in a thread kills only that thread. Sibling threads and the
main thread keep running. The exception is stored and re-raised at the moment you
`join` (or ask for `value`):

```ruby
t = Thread.new { raise ArgumentError, "bad input" }
sleep 0.1
t.status   # => nil  (terminated with an exception; `false` means finished cleanly)
t.join     # => ArgumentError: bad input, raised *here*, in the main thread
```

Two knobs change that behavior:

- `Thread.report_on_exception` — **defaults to `true`** since Ruby 2.5, so an
  unhandled thread exception at least prints a warning to `stderr` when the
  thread dies. It only reports; it does not stop anything. Set it to `false` per
  thread (`t.report_on_exception = false`) when a thread is *expected* to die
  noisily.
- `Thread.abort_on_exception = true` (or running with the `-d` flag) escalates:
  an uncaught exception in any thread is re-raised in the main thread, killing
  the process. There is a per-thread form too, `t.abort_on_exception = true`, for
  making just one critical thread fatal.

The practical rule: if you spawn a thread and never collect it, wrap its body in
your own `begin/rescue` and log there. Otherwise a warning on stderr is the only
trace you get.

### Thread-local vs. fiber-local storage

Ruby has two per-thread stores, and the difference bites in fiber-heavy servers:

```ruby
Thread.current[:request_id] = "abc-123"     # fiber-local, despite the name
Thread.current[:request_id]                 # => "abc-123"

Thread.current.thread_variable_set(:request_id, "abc-123")  # truly thread-local
Thread.current.thread_variable_get(:request_id)             # => "abc-123"
```

`Thread.current[]`/`[]=` (and `key?`, `keys`) are **fiber-local**: a new fiber
running inside the same thread starts with an empty store and cannot see values
set outside it. `thread_variable_get`/`thread_variable_set` (and
`thread_variables`) are attached to the thread itself and are visible from every
fiber in that thread.

```ruby
Thread.current[:tenant] = "acme"
Fiber.new { Thread.current[:tenant] }.resume                    # => nil
Thread.current.thread_variable_set(:tenant, "acme")
Fiber.new { Thread.current.thread_variable_get(:tenant) }.resume # => "acme"
```

Either store is readable from outside via the thread object
(`worker[:progress]`), which makes them handy for exposing a worker's state. On
Rails, prefer `ActiveSupport::CurrentAttributes` over touching these directly —
it wraps the same idea and, importantly, clears itself between requests. Storage
that is never cleared is how a stale `current_user` leaks into the next request
on a reused thread.

### Beyond `synchronize`: `try_lock` and non-blocking patterns

`Thread::Mutex#synchronize` is the right default for "I must do this exclusively,
and I'm willing to wait." `try_lock` covers the other case: it attempts to take
the lock and returns `true`/`false` immediately instead of blocking. That turns a
queue of waiting threads into a single worker plus N threads that carry on.

```ruby
class CacheRefresher
  def initialize = @lock = Thread::Mutex.new

  # Exactly one thread rebuilds; everyone else keeps serving the stale value.
  def refresh_unless_busy(cache)
    return :busy unless @lock.try_lock

    begin
      cache.rebuild!
      :refreshed
    ensure
      @lock.unlock
    end
  end
end
```

Note the shape: `try_lock` has no block form, so **you** own the `unlock`, and it
belongs in an `ensure` — that is exactly the guarantee `synchronize` gives you for
free, which is why the block form stays the default whenever blocking is
acceptable.

The same primitive avoids the classic two-lock deadlock. When two threads each
hold one lock and want the other's, they wait forever; taking the second lock
with `try_lock` lets a thread back off and retry instead:

```ruby
def transfer(from, to, amount)
  from.lock.synchronize do
    return :retry_later unless to.lock.try_lock   # back off rather than deadlock

    begin
      from.balance -= amount
      to.balance   += amount
      :ok
    ensure
      to.lock.unlock
    end
  end
end
```

`return` from inside `synchronize` is safe — the mutex is released on the way
out — but the inner `try_lock` still needs its own `ensure`. Related helpers:
`locked?` (true if *any* thread holds it — a status check, never a substitute for
`try_lock`), `owned?` (true if the *current* thread holds it), and
`Thread::Mutex#sleep`, which releases the lock while sleeping and reacquires it
after, the building block behind `ConditionVariable`.

### Driving external processes

Threads are not the only concurrency in a Ruby program; sometimes the work
belongs in another OS process entirely.

```ruby
system("bundle exec rubocop")       # blocks; => true (exit 0), false, or nil (command not found)
$?.exitstatus                       # => 0 / 1 / ...

pid = spawn("ffmpeg -i in.mov out.mp4")   # returns immediately with the PID
# ... do other work ...
Process.wait(pid)                          # block until that child finishes

sha = `git rev-parse HEAD`.strip           # backticks capture stdout as a String

IO.popen("sort", "w+") do |io|             # bidirectional pipe
  io.puts "banana", "apple", "cherry"
  io.close_write                           # signal EOF or `read` hangs forever
  io.read                                  # => "apple\nbanana\ncherry\n"
end
```

Two things the condensed version hides. First, `system` and `spawn` accept an
**array-style** argument list that skips the shell entirely —
`system("git", "checkout", branch)` is injection-safe, while
`system("git checkout #{branch}")` hands `branch` to `/bin/sh`. Always prefer the
multi-argument form for anything with interpolated input. Second, backticks give
you stdout only; when you need stdout, stderr, and the exit status together,
`Open3.capture3` is the modern answer:

```ruby
require "open3"
stdout, stderr, status = Open3.capture3("git", "status", "--porcelain")
```

### Fibers: cooperative coroutines

A fiber is a block of code with its own stack that can be paused and resumed.
Unlike threads, fibers are **not preemptive**: the scheduler never takes control
away from a running fiber. Control moves only when the fiber itself calls
`Fiber.yield`, or when the outside calls `resume`.

```ruby
fib = Fiber.new do
  a, b = 0, 1
  loop do
    Fiber.yield a
    a, b = b, a + b
  end
end

5.times.map { fib.resume }   # => [0, 1, 1, 2, 3]
fib.alive?                   # => true (an infinite loop never finishes)
```

`resume` returns whatever `Fiber.yield` was given; symmetrically, the value passed
to `resume` becomes the return value of the `Fiber.yield` that was waiting — so
the channel is two-way:

```ruby
echo = Fiber.new do |first|
  message = first
  loop { message = Fiber.yield("got: #{message}") }
end

echo.resume("hello")   # => "got: hello"
echo.resume("world")   # => "got: world"
```

When the block finally ends, the fiber is dead; `alive?` returns `false` and
another `resume` raises `FiberError`. This is what makes fibers a clean fit for
generators: producer logic stays a straightforward loop, and the consumer pulls
one value at a time. That said, `Enumerator` — which is itself built on fibers —
is the more idiomatic tool for the generator case today, and
`Enumerator::Lazy` handles infinite sequences with less ceremony:

```ruby
fibs = Enumerator.new do |y|
  a, b = 0, 1
  loop { y << a; a, b = b, a + b }
end
fibs.lazy.select(&:even?).first(5)   # => [0, 2, 8, 34, 144]
```

Reach for a raw `Fiber` when you need the two-way communication or explicit
pause/resume control that `Enumerator` doesn't expose.

### Non-blocking fibers (the advanced path)

`Fiber.new(blocking: false)` (and its shorthand `Fiber.schedule`) marks a fiber
as non-blocking: when it hits blocking I/O, Ruby hands control to a **fiber
scheduler** instead of blocking the thread, letting another fiber run. The
catch is that Ruby ships the `Fiber::Scheduler` *interface* but no
implementation — `Fiber.set_scheduler` needs a scheduler object you install from
a gem (the `async` ecosystem is the well-known one) or write yourself. Without
one, `blocking: false` changes nothing. Treat this as a real but rarely
hand-rolled path: you typically adopt it by adopting a framework that has already
set the scheduler up.

## Trade-offs

- **`value` over `join` when the thread computes something** — `join` returns the
  thread, so `threads.map(&:join)` gives you an array of `Thread` objects, a
  common surprise. `threads.map(&:value)` gives you the results, and both
  re-raise the thread's exception in the caller.
- **A thread you never collect is a thread whose failures you never see** —
  `report_on_exception` prints to stderr, which is invisible in most background
  job setups. Either collect the thread, or wrap its body in your own
  `rescue`+log. Turning on the global `Thread.abort_on_exception` makes failures
  loud, but it also means one background hiccup takes the whole process down;
  the per-thread form is usually the more proportionate choice.
- **`Thread.current[]` is fiber-local, and that mismatch is silent** — under a
  fiber-based server or any `Enumerator`-heavy code, values set outside a fiber
  are simply invisible inside it, with no error. Use `thread_variable_get/set`
  when you truly mean the thread, and prefer a framework abstraction
  (`CurrentAttributes`) that also handles cleanup.
- **`try_lock` avoids blocking, but transfers the unlock burden to you** — no
  block form means no automatic release. A `try_lock` without a matching `ensure
  ... unlock` is a lock leaked on the first exception, which then hangs every
  future waiter.
- **`Thread::Mutex` is not reentrant** — a thread that already holds a mutex and
  calls `synchronize` on it again raises
  `ThreadError: deadlock; recursive locking`. Recursive helper methods that each
  "defensively" lock are the usual culprit; lock once at the boundary instead.
  ```ruby
  m = Thread::Mutex.new
  m.synchronize { m.synchronize { } }   # => ThreadError
  ```
- **String-form `system`/backticks run a shell** — convenient for a fixed
  command, a shell-injection hole the moment user data is interpolated. The
  array form (`system("ls", dir)`) has no such exposure and costs nothing.
- **Fibers are far cheaper than threads but demand cooperation** — no GVL
  contention, no locking needed between them since only one runs at a time, but a
  fiber that performs a long CPU-bound stretch without yielding starves every
  other fiber in that thread. And non-blocking fibers only pay off once a
  scheduler is installed; without one, `blocking: false` is a no-op.

## Documentation Links

- [Thread — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Thread.html) — doc
- [Thread::Mutex — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Thread/Mutex.html) — doc
- [Fiber — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Fiber.html) — doc
- [Programming Ruby 3.3 (Pickaxe) — Threads, Fibers, and Ractors](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc

---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A Tokio `Runtime` bundles three services: a scheduler that polls tasks, an I/O driver
that turns OS readiness events into wakeups, and a timer. This lesson opens each one at
the level the Tokio documentation describes it (queues, work stealing, the LIFO slot,
the cooperative budget, the driver and the timer wheel), then measures the failure that
hurts production most: a task that blocks its worker thread. You will see the stall in
milliseconds and the three ways out: `spawn_blocking`, `block_in_place` and not blocking.

Measured with Rust 1.100.0, tokio 1.54.1 (the current release, `features = ["full"]`)
and mio 1.2.4 (from `Cargo.lock`), release builds on an Apple M4 Max (14 cores, macOS).
Every number below was stable across at least 3 runs; varying numbers are called out.

## Use Cases

- Choosing between `#[tokio::main]` (multi-thread) and `flavor = "current_thread"` for a
  server, a CLI, a test or an embedded runtime inside a sync application.
- Explaining a p99 latency spike in an axum or tonic service: a sync database driver,
  `std::fs`, a password hash or a big JSON parse running inside a handler.
- Sizing `worker_threads` and `max_blocking_threads` for a container with a CPU limit.
- Writing a hand-made `Future` or `Stream` that must not starve its neighbours.
- Reading runtime metrics and knowing which ones need `--cfg tokio_unstable`.

## Deep Dive

### Two schedulers, and drivers you must switch on

`Runtime::new()` and `#[tokio::main]` build the multi-thread scheduler with one worker
per core (`std::thread::available_parallelism`), overridable with
`TOKIO_WORKER_THREADS` or `Builder::worker_threads`:

```text
$ ./workers
#[tokio::main] workers = 14, available_parallelism = 14
$ TOKIO_WORKER_THREADS=3 ./workers
#[tokio::main] workers = 3, available_parallelism = 14
```

The current-thread scheduler runs every task on the thread that calls `block_on` and
spawns no workers. A hand-built `Builder` enables no driver, so the first `sleep` or
socket panics at runtime, not at compile time:

```rust
let rt = tokio::runtime::Builder::new_current_thread().build().unwrap(); // no enable_all()
rt.block_on(async { tokio::time::sleep(Duration::from_millis(1)).await });
```

```text
A Tokio 1.x context was found, but timers are disabled. Call `enable_time` on the runtime builder to enable timers.
A Tokio 1.x context was found, but IO is disabled. Call `enable_io` on the runtime builder to enable IO.
```

Writing `rt.block_on(tokio::time::sleep(..))` without the `async` block gives a third,
misleading message (`there is no reactor running, must be called from the context of a
Tokio 1.x runtime`): the `Sleep` is created before `block_on` enters the runtime.

### Worker queues and work stealing

According to the runtime docs ("behavior at the time of writing"), each worker owns a
local queue of at most 256 tasks (overflow moves half to the global queue). A worker
prefers its local queue, checks the global queue every `global_queue_interval` polls
(31 on current-thread; on multi-thread a heuristic targeting 10 ms between checks), and
when both are empty it steals half of another worker's local queue. Tasks spawned or
woken from a worker go to that worker; from any other thread they go to the global queue.

Measured: one task on a worker spawns 32 CPU-bound children (5 ms spin each), so all 32
start in that worker's local queue. Steal counters need `RUSTFLAGS="--cfg tokio_unstable"`:

```rust
let hs: Vec<_> = (0..32).map(|_| tokio::spawn(async {
    spin(Duration::from_millis(5));
    format!("{:?}", std::thread::current().id())
})).collect();
// later: m.worker_steal_operations(w), m.worker_steal_count(w)
```

```text
tasks per worker thread: {"ThreadId(2)": 8, "ThreadId(3)": 8, "ThreadId(4)": 8, "ThreadId(5)": 8}
worker 0: steal_operations=3 tasks_stolen=5
worker 1: steal_operations=1 tasks_stolen=16
worker 2: steal_operations=2 tasks_stolen=14
worker 3: steal_operations=3 tasks_stolen=8
```

The 8/8/8/8 split held in 13 of 13 runs; the steal counters changed every run (a task
can be stolen more than once, so the sum can exceed 32).

### The LIFO slot

When a task wakes another task on a multi-thread worker, the woken task goes into the
worker's LIFO slot and runs next (the 2019 scheduler post gives the reason: the message
is still in the CPU cache when its receiver runs). The runtime docs list the guard rails: the slot is not stealable, the coop budget is not reset
when it is used, and after 3 consecutive LIFO polls it is disabled until a normal task
runs. `Builder::disable_lifo_slot` exists but is unstable. A ping-pong of 200 000 round
trips over two `mpsc::channel(1)` on 4 workers:

```text
lifo slot on:   25 ms   lifo slot off:   40 ms   (200k round trips)
```

Same split in 6 of 6 runs. The cost of the slot is that a woken task can sit behind a
busy (or blocked) worker instead of being stolen, which is why the knob exists.

### Cooperative budgeting

Tokio cannot preempt a future. The `coop` docs describe the opt-in answer: Tokio's own
resources (channels, sockets, timers) are yield points that spend a per-task budget when
they are ready, and return `Pending` once it is gone, forcing the task back to the
scheduler. On a current-thread runtime,
task A awaits 10 000 always-ready operations; task B records how far A got when B ran:

```rust
match kind {
    "std::future::ready" => std::future::ready(()).await,
    "mpsc recv (tokio resource)" => { rx.recv().await.unwrap(); }
    "consume_budget" => tokio::task::consume_budget().await,
    "yield_now" => tokio::task::yield_now().await,
}
```

```text
std::future::ready           A had done 10000 iterations when B first ran
mpsc recv (tokio resource)   A had done   128 iterations when B first ran
consume_budget               A had done   128 iterations when B first ran
yield_now                    A had done     0 iterations when B first ran
```

`std::future::ready` (and any non-Tokio future, or a plain CPU loop) never yields, so B
waited for all 10 000. The budget of 128 is not in the public docs; it is
`Budget::initial()` in tokio 1.54.1's source and the measurement agrees.
`consume_budget` is the cheap opt-in for long loops: it yields only when the budget is
spent, unlike `yield_now`, which yields every time. `task::coop::unconstrained` opts a
future out of budgeting entirely.

### The I/O driver and the timer

The runtime docs call the I/O event loop "the driver": it drives I/O resources and
dispatches their events to the tasks waiting on them. Underneath is mio's `Poll`, a
readiness API that mio's docs map to epoll (Linux, Android), kqueue (macOS, iOS, BSDs)
and, through an adapter for its completion model, IOCP (Windows). The `KQUEUE` rows of
`lsof -p <pid>` on an idle process, 3 runs each:

```text
Builder without enable_io:  (none)
Builder with enable_io:     3u KQUEUE, 4u KQUEUE, 5u KQUEUE
```

The runtime docs say the driver is polled whenever a worker has nothing to run and
every 61 scheduled tasks (`event_interval`). The timer works in whole milliseconds
(`sleep` docs), and the comment on tokio's internal time `Driver` describes a
hierarchical wheel of 6 levels with 64 slots each (1 ms slots at level 0, up to about
2 years), after Varghese and Lauck's hashed and hierarchical timing wheels.
Measured, 100 sleeps per row on a current-thread runtime:

```text
sleep( 100 us) x100: mean 1625 us
sleep(1000 us) x100: mean 3347 us
sleep(1500 us) x100: mean 3177 us
```

Means varied 1.6 to 1.8 ms and 2.9 to 3.3 ms across 3 runs; the stable claim is only
that a sub-millisecond sleep never returns in under 1 ms here.

### Blocking a worker: the measured stall

Two workers, a heartbeat task that sleeps 10 ms in a loop and records its worst gap, and
two jobs that call a 300 ms synchronous function (standing in for a sync DB driver):

```rust
let jobs: Vec<_> = (0..2).map(|_| tokio::spawn(async move {
    let work = || std::thread::sleep(Duration::from_millis(300));
    match mode {
        "std::thread::sleep in task" => work(),
        "spawn_blocking" => tokio::task::spawn_blocking(work).await.unwrap(),
        "block_in_place" => tokio::task::block_in_place(work),
    }
})).collect();
```

```text
std::thread::sleep in task   2 jobs: 303 ms  worst heartbeat gap: 303 ms
spawn_blocking               2 jobs: 310 ms  worst heartbeat gap:  13 ms
block_in_place               2 jobs: 310 ms  worst heartbeat gap:  13 ms
```

Five runs: blocked 301 to 310 ms, both fixes 13 to 14 ms (13 ms is the baseline
for a 10 ms sleep). The jobs take the same time either way; what changes is whether
every other task on those workers, including the driver, freezes with them. On a
current-thread runtime one blocking job is enough (`worst heartbeat gap: 302 ms`),
`spawn_blocking` still fixes it (13 ms, the pool is separate), and `block_in_place`
panics inside the task:

```text
can call blocking only when running on the multi-threaded runtime
```

### spawn, spawn_blocking, block_in_place

- `tokio::spawn`: a future on the worker pool; it must reach an `.await` often.
- `spawn_blocking`: a closure on a separate pool, created on demand up to
  `max_blocking_threads` (default 512), idle threads exit after 10 s; beyond the limit
  calls queue. `tokio::fs`, `ToSocketAddrs` DNS and stdio already go through it. Once
  started it cannot be aborted, and runtime shutdown waits for it.
- `block_in_place`: turns the current worker into a blocking thread and hands its queued
  tasks to a new worker, saving a context switch. Multi-thread only, and anything else in
  the same task (a `join!` sibling) is frozen too.

## Trade-offs

- **Multi-thread by default**: work stealing gives throughput and a second worker that
  keeps running when one task is slow, at the cost of `Send + 'static` futures and
  cross-thread wakeups.
  Current-thread fits tests, CLIs and a runtime embedded in sync code, but one blocking
  call stops everything (302 ms measured above).
- **`spawn_blocking` for CPU work**: correct for bounded calls, but 512 threads of
  hashing will oversubscribe the cores. Cap it with a `Semaphore`, or send CPU-heavy
  batches to rayon; long-lived loops deserve a dedicated `std::thread`.
- **`block_in_place` is cheaper but sharper**: no copy into a closure and no thread hop,
  yet it panics on current-thread and freezes `join!`/`select!` siblings in the task.
- **Coop is not preemption**: only Tokio resources and `consume_budget` spend budget.
  A loop over `std` iterators or third-party futures starved its neighbour for all
  10 000 iterations above. Insert `consume_budget().await` or move the work off-runtime.
- **Unstable knobs**: steal counts, poll counts and `disable_lifo_slot` require
  `--cfg tokio_unstable` and carry no SemVer promise. Stable metrics such as
  `num_workers`, `num_alive_tasks` and `global_queue_depth` cover the basics.
- **Timer granularity**: 1 ms is the floor. For sub-millisecond pacing, Tokio is the
  wrong tool; batch the work or spin on a dedicated thread.
- **Scheduler details move**: the docs label the queue sizes, the 31/61 intervals and
  the LIFO rules "behavior at the time of writing". Tune with metrics, not with constants
  copied from this page. The docs also note the runtime is not NUMA aware: several
  runtimes, one per node, is their suggestion.

## Documentation Links

- [Tokio runtime module: detailed runtime behavior](https://docs.rs/tokio/latest/tokio/runtime/index.html): doc
- [tokio::runtime::Builder](https://docs.rs/tokio/latest/tokio/runtime/struct.Builder.html): doc
- [tokio::task::coop: cooperative scheduling](https://docs.rs/tokio/latest/tokio/task/coop/index.html): doc
- [tokio::task::spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html): doc
- [tokio::task::block_in_place](https://docs.rs/tokio/latest/tokio/task/fn.block_in_place.html): doc
- [tokio::runtime::RuntimeMetrics](https://docs.rs/tokio/latest/tokio/runtime/struct.RuntimeMetrics.html): doc
- [mio::Poll: the OS selector per platform](https://docs.rs/mio/latest/mio/struct.Poll.html): doc
- [Tokio tutorial](https://tokio.rs/tokio/tutorial): doc
- [Tokio topics: bridging with sync code](https://tokio.rs/tokio/topics/bridging): doc
- [Making the Tokio scheduler 10x faster, Tokio blog (complement)](https://tokio.rs/blog/2019-10-scheduler): doc
- [Varghese and Lauck, Hashed and hierarchical timing wheels, IEEE/ACM ToN 1997](https://doi.org/10.1109/90.650142): paper

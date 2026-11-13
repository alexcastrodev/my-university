---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A future has no cancel method: you cancel it by dropping it, and it stops at whichever
`.await` it was parked on. That makes timeouts and `select!` cheap, and it makes a class
of bugs silent: the branch that loses a `select!` race is dropped with its half-done
work. This lesson measures what dropping does, loses real data with a method the Tokio
docs list as not cancel safe, fixes it, and builds the graceful shutdown of the Tokio
"Graceful Shutdown" topic: detect the signal, broadcast cancellation, wait with a deadline.

Measured with Rust 1.100.0, tokio 1.54.1 and tokio-util 0.7.20 (`features = ["rt"]`),
from `Cargo.lock`, release builds on an Apple M4 Max with macOS; signals sent with `kill`.
Each program ran at least 3 times with the same result apart from timestamps.

## Use Cases

- A connection loop that `select!`s between frames, a heartbeat timer and shutdown.
- Request timeouts with `tokio::time::timeout`, which cancels the inner future by drop.
- A fan-out of N tasks where the first error must cancel the rest.
- A service in Kubernetes that must drain in-flight work between SIGTERM and SIGKILL.

## Deep Dive

### Dropping a future is cancellation

```rust
struct Guard(&'static str);
impl Drop for Guard { fn drop(&mut self) { println!("  drop: {}", self.0); } }
async fn step(name: &'static str, ms: u64) -> &'static str {
    let _g = Guard(name);
    println!("  {name}: started");
    sleep(Duration::from_millis(ms)).await;   // the only place it can be cancelled
    println!("  {name}: finished");
    name
}
// 1. select! { w = step("fast", 10) => w, w = step("slow", 1_000) => w }
// 2. drop(spawn(step("detached", 50)))  3. h.abort() after 10 ms  4. return from main
```

```text
1. select!: the losing branch is dropped at its .await
  fast: started
  slow: started
  fast: finished
  drop: fast
  drop: slow
  winner = fast
2. dropping a JoinHandle detaches, it does not cancel
  detached: started
  detached: finished
  drop: detached
3. abort() cancels at the next .await
  aborted: started
  drop: aborted
  join result: is_cancelled = true
4. a spawned task still pending when main returns
  orphan: started
  main returns
  drop: orphan
```

`slow: finished` never prints: its destructors ran, the code after its `.await` did not.
The two `started` lines swap places between runs, because `select!` picks the first branch
to poll at random unless you write `biased;`. A spawned task is different: dropping its
`JoinHandle` detaches it (case 2), and only `abort()` or runtime shutdown cancels it, as
the `tokio::task` docs state.

### Cancel safety, as the `select!` docs define it

The `select!` docs: "If you have a future that has not yet completed, then it must be a
no-op to drop that future and recreate it." Their lists, which they call not exhaustive:

- Cancel safe: `mpsc`/`broadcast` `recv`, `watch::Receiver::changed`, `TcpListener::accept`,
  `read`, `read_buf`, `write`, `write_buf`, and `StreamExt::next` on any `Stream`.
- Not cancel safe, data can be lost: `read_exact`, `read_to_end`, `read_to_string`, `write_all`.
- Not cancel safe because cancelling loses your place in a fair queue: `Mutex::lock`,
  `RwLock::read`/`write`, `Semaphore::acquire`, `Notify::notified`.

They add that cancelling something unsafe is not always wrong: during shutdown, a
partial frame usually does not matter.

### Losing data with `read_exact` in a `select!` loop

A writer sends 20 frames of 8 identical bytes, each in two halves 15 ms apart. The reader
also ticks a 10 ms timer in the same `select!` (a heartbeat or deadline check):

```rust
let mut buf = [0u8; 8];
loop {
    tokio::select! {
        r = rx.read_exact(&mut buf) => match r {
            Ok(_) => frames.push(buf),
            Err(_) => break, // EOF
        },
        _ = tick.tick() => ticks += 1,
    }
}
```

The fix keeps the partial bytes outside the future, in a buffer that survives every
iteration, and reads with `read_buf`, which is cancel safe:

```rust
let mut pending: Vec<u8> = Vec::with_capacity(64);
loop {
    tokio::select! {
        r = rx.read_buf(&mut pending) => {
            if r.unwrap() == 0 { break; }
            while pending.len() >= 8 {
                frames.push(pending[..8].try_into().unwrap());
                pending.drain(..8);
            }
        }
        _ = tick.tick() => ticks += 1,
    }
}
```

```text
read_exact frames=19 intact= 0 torn=19 ticks=34
           first torn frame: [1, 1, 1, 1, 2, 2, 2, 2]
read_buf   frames=20 intact=20 torn= 0 ticks=33
```

Identical frame counts in 5 of 5 runs (ticks 33 or 34). The tick won after half of frame
1 was in `buf`; the dropped `read_exact` took its progress along, and the next call
refilled `buf` from offset 0. Four bytes vanished, every later frame straddles two, the
last 4 bytes were discarded at EOF, and no error was raised. By the list above,
`StreamExt::next` on a `tokio_util::codec::FramedRead` is the same fix with a real codec.

### JoinSet: own a group of tasks

```rust
let mut set = JoinSet::new();
for ms in [300u64, 100, 200, 5_000] {
    set.spawn(async move { let _g = Guard(ms); sleep(Duration::from_millis(ms)).await; ms });
}
for _ in 0..3 { println!("  join_next -> {:?}", set.join_next().await.unwrap().unwrap()); }
println!("  len before drop = {}", set.len());
drop(set);
```

```text
  task 100 dropped
  join_next -> 100
  task 200 dropped
  join_next -> 200
  task 300 dropped
  join_next -> 300
  len before drop = 1
  task 5000 dropped
```

Results arrive in completion order, and dropping the set aborted the 5 s task, matching
the docs ("When the `JoinSet` is dropped, all tasks in the `JoinSet` are immediately
aborted"). `join_next` is documented as cancel safe, so it can sit in a `select!` arm.

### CancellationToken: broadcast "please stop"

```rust
let parent = CancellationToken::new();
let child = parent.child_token();
child.cancel();
let child2 = parent.child_token();
parent.cancel();
let r = parent.run_until_cancelled(sleep(Duration::from_secs(1))).await;
```

```text
  child.cancel():  parent=false child=true
  parent.cancel(): parent=true child2=true
  run_until_cancelled on a cancelled token -> None
```

Clones share one state; a `child_token` is cancelled with its parent but cancelling it
leaves the parent alone, so a connection can be closed without stopping the server.
`cancelled()` is cancel safe per the tokio-util docs. Unlike `abort()`, the token only
asks: the task decides where to stop and can run its cleanup first.

### Graceful shutdown with a deadline

Three workers each loop on `select!` between `token.cancelled()` (a child token) and a
50 ms unit of work, then flush for 200 ms; a fourth task ignores the token. After the
signal, main cancels, closes the `TaskTracker` and waits at most 1 s:

```rust
async fn shutdown_signal() -> &'static str {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = signal(SignalKind::terminate()).expect("cannot listen for SIGTERM");
    tokio::select! {
        r = tokio::signal::ctrl_c() => { r.expect("cannot listen for SIGINT"); "SIGINT" }
        _ = term.recv() => "SIGTERM",
    }
}
let sig = shutdown_signal().await;
log(format!("{sig} received, cancelling"));
token.cancel();
tracker.close();
match timeout(Duration::from_secs(1), tracker.wait()).await {
    Ok(()) => log("all tasks finished".into()),
    Err(_) => log(format!("deadline hit, {} task(s) still running, exiting", tracker.len())),
}
```

```text
$ kill -TERM <pid>      # exit status 0
  136 ms  SIGTERM received, cancelling
  136 ms  worker 2: cancelled after 2 jobs, flushing
  136 ms  worker 1: cancelled after 2 jobs, flushing
  136 ms  worker 0: cancelled after 2 jobs, flushing
  338 ms  worker 0: flushed
  338 ms  worker 2: flushed
  338 ms  worker 1: flushed
 1138 ms  deadline hit, 1 task(s) still running, exiting
 1138 ms  stubborn task dropped
```

The stubborn task was dropped when `main` returned and the runtime shut down. A first
version listened only to `ctrl_c()`, like the Tokio topic page: `kill -INT` worked, but
`kill -TERM` ended it with exit status 143, no log line and no flush (3 of 3 runs).
Kubernetes sends SIGTERM (or the image's `STOPSIGNAL`), then KILL when the grace period
ends (30 s by default), so a server that handles only SIGINT never drains in a pod.

## Trade-offs

- **Token vs `abort()`**: `abort()` needs no cooperation, but the task stops at any
  `.await` with no chance to flush. A token costs a `select!` arm per loop and gives a
  clean exit point; keep `abort()` (or dropping a `JoinSet`) for the leftovers.
- **Cancel-safe loop vs a dedicated task**: keeping state outside the future (the
  `pending` buffer) is the cheap fix. When a step is inherently unsafe (`write_all`,
  `Mutex::lock`), move it into its own task and `select!` on a channel instead.
- **`biased;`**: removes the random choice and the RNG cost, but an always-ready branch
  can then starve the rest. The docs advise putting the shutdown branch first.
- **TaskTracker vs JoinSet**: `JoinSet` keeps every result until you call `join_next` and
  aborts on drop. `TaskTracker` frees tasks as they exit, can be cloned, and waits only
  after `close()`; dropping it aborts nothing, so pair it with a deadline.
- **Deadline length**: keep the drain deadline below the orchestrator's grace period,
  leaving room for the process to exit, or SIGKILL makes the choice for you.
- **Blocking work escapes cancellation**: `spawn_blocking` closures and `block_in_place`
  cannot be aborted, and runtime shutdown waits for them. `Runtime::shutdown_timeout`
  stops waiting, but the threads keep running.

## Documentation Links

- [tokio::select!: cancellation safety](https://docs.rs/tokio/latest/tokio/macro.select.html): doc
- [Tokio topics: Graceful Shutdown](https://tokio.rs/tokio/topics/shutdown): doc
- [tokio::task module: cancellation](https://docs.rs/tokio/latest/tokio/task/index.html): doc
- [tokio::task::JoinSet](https://docs.rs/tokio/latest/tokio/task/struct.JoinSet.html): doc
- [tokio_util::sync::CancellationToken](https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html): doc
- [tokio_util::task::TaskTracker](https://docs.rs/tokio-util/latest/tokio_util/task/struct.TaskTracker.html): doc
- [tokio::signal::ctrl_c](https://docs.rs/tokio/latest/tokio/signal/fn.ctrl_c.html): doc
- [Kubernetes: Pod Lifecycle, termination of Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): doc

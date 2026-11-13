---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A future does nothing until something calls `poll`, which either finishes
(`Poll::Ready`) or returns `Poll::Pending` after arranging, through the `Waker`
in its `Context`, to be polled again. An `async fn` compiles into an enum-shaped
state machine holding every local alive across an `.await`; an executor is the
loop that polls and sleeps until a waker fires. This lesson builds each piece
with std only, measures future sizes, and shows the silent hang of a `Pending`
without a wake.

Measured with Rust 1.100.0 (rustc 0ef1bc386 2026-11-09), edition 2024, Apple
Silicon (aarch64-apple-darwin, macOS); one comparison uses tokio 1.54.1.

## Use Cases

- Writing a leaf future (a timer, a C callback completion) no runtime ships.
- Debugging a task that hangs, or always finishes exactly when an unrelated
  timeout fires: the classic lost wakeup.
- Finding multi-kilobyte futures in deep call chains and where `Box::pin` helps.
- Unit-testing a future by polling it by hand with `Waker::noop()`.

## Deep Dive

### The trait and a hand-written future

Besides `type Output`, the trait is one method: `fn poll(self: Pin<&mut Self>,
cx: &mut Context<'_>) -> Poll<Self::Output>`. `CountDown(n)` is ready after `n` polls;
before each `Pending` it calls `wake_by_ref()`, meaning "poll me again soon"
(the yield-now pattern):

```rust
struct CountDown(u32);
impl Future for CountDown {
    type Output = &'static str;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if self.0 == 0 { return Poll::Ready("done"); }
        self.0 -= 1;
        cx.waker().wake_by_ref();
        Poll::Pending
    }
}
let mut cx = Context::from_waker(Waker::noop()); // stable since 1.85
let mut fut = CountDown(2);
let mut fut = Pin::new(&mut fut); // fine: CountDown is Unpin
for i in 1..=3 { println!("poll {i}: {:?}", fut.as_mut().poll(&mut cx)); }
```

```text
poll 1: Pending
poll 2: Pending
poll 3: Ready("done")
```

Polling a finished `async` block again panicked with "`async fn` resumed after
completion"; the `Future` docs allow a panic or a hang there, never UB. The
Reference desugars `x.await` into a loop that pins the operand with
`Pin::new_unchecked`, calls `poll`, breaks on `Ready` and `yield`s on
`Pending`: that `yield` makes the body a resumable coroutine.

### Future size is whatever lives across `.await`

`yield_now()` is a 1-byte future that returns `Pending` once. Each value is
`std::mem::size_of_val(&f())` of an `async fn` that was never polled:

```rust
async fn buf_dropped_before_await() { { let b = [7u8; 1024]; black_box(&b); } yield_now().await; }
async fn buf_held_across_await() { let b = [7u8; 1024]; yield_now().await; black_box(&b); }
async fn two_phases() {
    let a = [1u8; 1024]; yield_now().await; black_box(&a);
    let b = [2u8; 2048]; yield_now().await; black_box(&b);
}
async fn two_scoped_phases() {
    { let a = [1u8; 1024]; yield_now().await; black_box(&a); }
    { let b = [2u8; 2048]; yield_now().await; black_box(&b); }
}
async fn awaits_big_child()   { buf_held_across_await().await; }
async fn awaits_boxed_child() { Box::pin(buf_held_across_await()).await; }
```

```text
buf_dropped_before_await     2
buf_held_across_await     1026
two_phases                3074
two_scoped_phases         2050
awaits_big_child          1027
awaits_boxed_child          16
```

Same numbers in debug and release. A buffer that dies before the `.await`
costs nothing. `two_phases` keeps `a` in scope during the second `.await`, so
both arrays coexist; closing the scopes lets them share bytes (2050). Awaiting
a child embeds the whole child (1026 + 1), so sizes add up along the call
chain, and `Box::pin` swaps the child for an 8-byte pointer. Clippy's pedantic
`large_futures` lint (default threshold 16384 bytes) flagged a 20002-byte child
here with "help: consider `Box::pin` on it: `Box::pin(huge())`".

### The state machine behind it

The unstable `-Zprint-type-sizes` (here on 1.100.0 via `RUSTC_BOOTSTRAP=1`,
fine for a one-off look, never for a build; line prefix trimmed) prints it:

```text
type: `{async fn body of two_phases()}`: 3074 bytes, alignment: 1 bytes
    discriminant: 1 bytes
    variant `Unresumed`: 0 bytes
    variant `Suspend0`: 1025 bytes
        local `.a`: 1024 bytes
        local `.__awaitee`: 1 bytes, type: YieldNow
    variant `Suspend1`: 3073 bytes
        local `.a`: 1024 bytes
        local `.__awaitee`: 1 bytes, type: YieldNow
        local `.b`: 2048 bytes
    variant `Returned`: 0 bytes
    variant `Panicked`: 0 bytes
```

`Unresumed` holds the arguments before the first poll, each `SuspendN` holds
the locals alive at that `.await` plus the child being awaited (`__awaitee`),
and `Returned` is what produces the panic above. Arguments can count twice:
`async fn with_arg(x: [u8; 512])` measured 1026 bytes, because `Suspend0`
keeps both the captured argument (`upvar .x`) and the body's copy (`local .x`).

### Context and Waker: the contract

From the std docs (the compiler checks none of it): returning `Pending`
obliges the future to store a clone of `cx.waker()` and wake it when progress
is possible, and on repeated polls "only the `Waker` from the `Context` passed
to the most recent call should be scheduled". `Waker` is `Send + Sync`, so a
timer thread, an epoll loop or a C callback may wake it; each `wake()`
happens-before at least one later `poll`, and wakes may coalesce. `Wake`
(1.51) builds a `Waker` from an `Arc<W>` safely; the `unsafe` `RawWaker`
vtable remains for executors that cannot allocate.

### A minimal executor: `block_on` with thread park

The `Wake` docs ship this executor; only the poll counter is new:

```rust
struct ThreadWaker(Thread);
impl Wake for ThreadWaker {
    fn wake(self: Arc<Self>) { self.0.unpark(); }
}
fn block_on<T>(fut: impl Future<Output = T>) -> T {
    let mut fut = pin!(fut);
    let waker: Waker = Arc::new(ThreadWaker(thread::current())).into();
    let mut cx = Context::from_waker(&waker);
    let mut polls = 0;
    loop {
        polls += 1;
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            println!("[block_on] ready after {polls} polls");
            return v;
        }
        thread::park(); // sleep until some Waker calls unpark
    }
}
```

The leaf is a `Sleep` shaped like the async book's `TimerFuture`: a shared
`Mutex<{ done, waker }>` and a thread spawned on first poll that sleeps, sets
`done` and calls `waker.take().wake()`. Every poll that returns `Pending`
refreshes the stored waker with `w.clone_from(cx.waker())`, which skips the
clone when `will_wake` says it is the same task. Running
`block_on(async { sleep(50 ms).await; sleep(20 ms).await; 7 })`:

```text
after 1st sleep: 54.687583ms
after 2nd sleep: 80.35325ms
[block_on] ready after 3 polls
value = 7, total 80.361625ms
```

Three release runs: always 3 polls (start, then once per wake), totals 80 to
85 ms for 70 ms of sleep; the thread parks, nothing spins. The docs warn this
executor trades correctness for simplicity: a future that itself uses
`park`/`unpark`, or a nested `block_on`, breaks it.

### `Pending` without a wake: the silent hang

`YieldOnce` returns `Pending` once, then `Ready`; `wake` decides whether it
asks to be re-polled. `block_on` runs on a worker thread, main waits 2 s:

```rust
fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
    if self.yielded { return Poll::Ready(()); }
    self.yielded = true;
    if self.wake { cx.waker().wake_by_ref(); } // the line that matters
    Poll::Pending
}
```

```text
wake=false: Timeout after 2s, executor thread parked forever
wake=true: completed
```

No error, no CPU, no log: the task is never polled again. Under tokio (current
thread runtime) the waker-less `YieldOnce` hides better:

```text
tokio::time::timeout(Duration::from_millis(500), YieldOnce { yielded: false }).await
=> Ok(()) after 509.945959ms
```

Three runs: `Ok(())` after 508 to 511 ms, never `Err(Elapsed)`. The timer's
wake re-polls the whole task and, per the tokio docs, "the future is polled
before the timeout is checked", so the buggy future completes. In production
this looks like latency pinned to an unrelated timer, not like a hang.

## Trade-offs

- **Stackless futures**: no stack to reserve or grow, size known at compile
  time. The price: every byte held across `.await` lives in the future and is
  copied when it moves. Java's virtual threads are the stackful alternative.
- **Box the big children**: `Box::pin(child()).await` cut 1027 bytes to 16 for
  one allocation per call; do it where `large_futures` points, not everywhere.
- **Hand-written futures only at the leaves**: `async fn` gets the wake
  contract right by construction. A manual `poll` that forgets the waker
  compiles, passes tests that have another wake source, and hangs in
  production. Prefer `std::future::poll_fn` (1.64) or an existing primitive.
- **Wake rules are documentation, not types**: tolerate extra polls (wakes
  coalesce), and use `will_wake`/`clone_from` to avoid re-cloning the waker.
- **`block_on` is not a runtime**: no I/O reactor or timer wheel, so each
  `Sleep` burns an OS thread; sockets need the tokio runtime lesson.

## Documentation Links

- [std::future::Future, Rust standard library](https://doc.rust-lang.org/std/future/trait.Future.html): doc
- [std::task::Waker, Rust standard library](https://doc.rust-lang.org/std/task/struct.Waker.html): doc
- [std::task::Wake (block_on example), Rust standard library](https://doc.rust-lang.org/std/task/trait.Wake.html): doc
- [Await expressions, The Rust Reference](https://doc.rust-lang.org/reference/expressions/await-expr.html): doc
- [Task Wakeups with Waker, Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/02_execution/03_wakeups.html): doc
- [Applied: Build an Executor, Asynchronous Programming in Rust](https://rust-lang.github.io/async-book/02_execution/04_executor.html): doc
- [tokio::time::timeout, tokio docs](https://docs.rs/tokio/latest/tokio/time/fn.timeout.html): doc
- [Clippy lints (large_futures), Clippy 1.100.0](https://clippy.rust-lang.org/rust-1.100.0/index.html#large_futures): doc
- [Rust for Rustaceans (Jon Gjengset, No Starch Press 2021), chapter 8: Asynchronous Programming](https://nostarch.com/rust-rustaceans): book

---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Goroutines are cheap; the hard part is the shape around them: a pipeline that stops
when its consumer stops, a fan-out that does not flood the database, a group that
fails fast, a cache miss that hits the backend once instead of a hundred times. This
lesson builds each pattern from the Go blog's pipelines article (moved from a `done`
channel to `context`), `errgroup`, `semaphore` and `singleflight` from `golang.org/x/sync`,
and `sync.WaitGroup.Go` (Go 1.25), measuring goroutine counts, peak concurrency,
orderings and executions. Measured with Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, module
line `go 1.27`) and `golang.org/x/sync v0.25.0` on an Apple M4 Max (14 cores, arm64),
macOS 27.0.1, 3 runs per program; every demo is clean under `-race`.

## Use Cases

- Calling N shards or URLs with a concurrency cap and fail-fast on the first error.
- Stage chains (read, decode, transform, write) that must not leak when the consumer quits early.
- Cache-miss stampedes: 100 requests for the same key should cost one database query.
- Weighted budgets: image decodes that reserve megabytes instead of slots.
- Migrating `wg.Add(1)` / `defer wg.Done()` code to `wg.Go` with `go fix`.

## Deep Dive

### Pipelines that stop: context instead of a done channel

The blog's rules: stages close their outbound channels when all sends are done, and
keep receiving until inbound channels are closed or the senders are unblocked. To
unblock senders it closes a `done` channel as a broadcast that every send selects
on; `ctx.Done()` is the same mechanism, with deadlines and causes:

```go
func sq(ctx context.Context, in <-chan int) <-chan int {
	out := make(chan int)
	go func() {
		defer close(out)
		for n := range in {
			select {
			case out <- n * n:
			case <-ctx.Done():
				return
			}
		}
	}()
	return out
}
// gen and merge send the same way (a small generic send helper); merge runs one wg.Go per input.

in := gen(ctx, 1, 2, 3, 4, 5, 6, 7, 8)
out := merge(ctx, sq(ctx, in), sq(ctx, in)) // fan-out to two sq, fan-in by merge
fmt.Println("first value:", <-out)          // the consumer wants only one value
```

The leaky run passes `context.Background()`; the fixed run calls `cancel()` after reading:

```text
goroutines at start: 1
first value: 1
goroutines after early return, no cancel: 7
first value: 4
goroutines after cancel (leaky ones still there): 7
```

Without cancellation six goroutines (gen, two `sq`, two merge workers, the closer)
block on a send forever; the canceled pipeline left none (the 7 are all from the
first one). The first value changed between runs: fan-in has no order.

### Fan-out, fan-in and order

Four workers squaring 1 to 8 from one shared channel, run 10,000 times in one process:

```text
fan-in: 243 distinct orders in 10000 runs, 20 runs in input order
fan-in: 232 distinct orders in 10000 runs, 19 runs in input order
```

When order matters, send `job{i, n}` and have workers write `res[j.i] = j.n * j.n`
into a preallocated slice: each worker writes a different element, so there is no
race, and the output was `[1 4 9 16 25 36 49 64]` every time.

### Bounded parallelism: SetLimit, semaphore, buffered channel

Twenty tasks of 20 ms, limit 3; a probe records peak tasks in flight and peak `runtime.NumGoroutine()`:

```go
var g errgroup.Group
g.SetLimit(3)
for range 20 {
	g.Go(func() error { p.work(); return nil }) // blocks here while 3 run
}

sem := semaphore.NewWeighted(3)
for range 20 {
	wg.Go(func() { // Acquire inside: 20 goroutines exist, 3 work
		sem.Acquire(ctx, 1)
		defer sem.Release(1)
		p.work()
	})
}
```

```text
errgroup.SetLimit(3)         max active 3, peak goroutines  4, took 150ms
semaphore, Acquire inside    max active 3, peak goroutines 20, took 150ms
semaphore, Acquire before go max active 3, peak goroutines  4, took 150ms
chan struct{}, cap 3         max active 3, peak goroutines  4, took 150ms
```

"Acquire before go" moves `sem.Acquire` into the loop; the channel variant sends a
token on a `make(chan struct{}, 3)` before each `wg.Go` and receives it in a deferred
func (k-th receive before send k+3). All cap the work at 3 and take 150 ms (7 waves
of 20 ms plus overhead). What differs is where the waiting happens: `SetLimit` blocks
the caller of `g.Go` (in v0.25.0 it is a buffered channel of tokens), so goroutines
never pile up; acquiring inside the goroutine bounds the work, not the goroutines,
which matters at 100,000 tasks. `TryGo` returned `false` once the limit was full, and
changing the limit while tasks run panics: `errgroup: modify limit while 2 goroutines in the group are still active`.

### Weighted semaphore: FIFO, so big requests are not starved

```go
sem := semaphore.NewWeighted(10) // e.g. 10 MB of decode buffer
sem.Acquire(ctx, 8)              // a running job holds 8
fmt.Println("TryAcquire(1), queue empty:", sem.TryAcquire(1)); sem.Release(1)
go func() { sem.Acquire(ctx, 10); fmt.Println("big(10) acquired after", since()); sem.Release(10) }()
time.Sleep(10 * time.Millisecond) // big is queued now, 2 tokens are free
fmt.Println("TryAcquire(1), big queued, 2 free:", sem.TryAcquire(1))
go func() { sem.Acquire(ctx, 1); fmt.Println("small(1) acquired after", since()); sem.Release(1) }()
time.Sleep(100 * time.Millisecond)
sem.Release(8) // the job finishes; later, Acquire(11) with a 20 ms timeout
```

```text
TryAcquire(1), queue empty: true
TryAcquire(1), big queued, 2 free: false
big(10) acquired after 112ms
small(1) acquired after 112ms
Acquire(11) on size 10: context deadline exceeded
```

The small request queued behind the big one also waited for the job's 8 tokens; the
source says letting small waiters jump ahead would starve a writer that needs every
token. A request larger than the semaphore returns only when its context ends.

### First error wins: errgroup.WithContext

```go
g, ctx := errgroup.WithContext(context.Background())
for id := range 6 {
	g.Go(func() error { return fetch(ctx, id) })
}
// shard 2 fails at 10 ms, shard 4 at 15 ms, the others wait 1 s or ctx.Done()
err := g.Wait()
```

```text
ignoring=false Wait after 16ms: shard 2: connection refused | canceled tasks: 4 | cause: shard 2: connection refused
ignoring=true Wait after 301ms: shard 2: connection refused | canceled tasks: 4 | cause: shard 2: connection refused
```

The four healthy shards saw `context.Canceled` at once and `Wait` returned only the
first error (shard 4's `timeout` was dropped). `Wait` still waits for every function:
16 ms is shard 4's own sleep, and one extra task that ignores `ctx` (a 300 ms
`time.Sleep`) held `Wait` for 300 ms. `WithContext` uses `context.WithCancelCause`,
so `context.Cause(ctx)` names the failure. A panic in `g.Go` is not converted to an
error: the process crashed with `panic: bad input` before `Wait` returned (the
source cites issue 53757 for keeping it that way).

### singleflight: N callers, one execution

100 goroutines released together by closing a channel call
`g.Do("user:42", func() (any, error) { return loadUser(fail) })`; `loadUser` sleeps
50 ms and counts its executions:

```text
100 callers, fail=false: executions=1 shared=100 errors=0
100 callers, fail=false: executions=1 shared=100 errors=0
100 callers, fail=true: executions=1 shared=100 errors=100
caller gave up: context deadline exceeded
late joiner: val=user-42 shared=true executions=1
```

The second burst ran the function again: `singleflight` merges calls in flight, it is
not a cache. One failure reached all 100 callers. With `DoChan`, a caller stopped at
its 10 ms deadline while the call went on, and a later caller joined that execution.

### The first caller's context belongs to everyone

```go
_, err, _ := g.Do("k", func() (any, error) {
	if detach {
		ctx = context.WithoutCancel(ctx) // the shared call outlives any one caller
	}
	return query(ctx) // 50 ms, or ctx.Err()
})
```

Caller 0 has a 10 ms deadline and arrives first; nine callers without one join it:

```text
detach=false: 10 of 10 callers failed, first error: context deadline exceeded
detach=true: 0 of 10 callers failed, first error: <nil>
```

`Do` ignores the callers' contexts, so detached, caller 0 waited the full 50 ms past
its deadline; bound each caller's wait with `DoChan` and `select`.

### sync.WaitGroup.Go (Go 1.25)

`wg.Go(f)` calls `Add(1)` before starting the goroutine, which removes the classic
bug of calling `Add` inside it. That bug printed 0 of 3 lines in 3 of 3 runs (`Wait`
returned first); vet's `waitgroup` analyzer (Go 1.25) flags it and `go fix` rewrites the old form:

```text
wgvet/main.go:12:10: WaitGroup.Add called from inside new goroutine
$ go fix -diff ./wgfix
-		wg.Add(1)
-		go func() {
-			defer wg.Done()
+		wg.Go(func() {
 			fmt.Println(i)
-		}()
+		})
```

The doc says `f` "must not panic". The Go 1.27 source shows why: on a panic it re-panics
without calling `Done`, so `Wait` cannot unblock and let `main` exit before the crash report.

## Trade-offs

- **errgroup versus WaitGroup.Go**: errgroup adds the first error, cancellation and a
  limit; `WaitGroup.Go` is for work without errors. Neither recovers panics.
- **SetLimit versus semaphore versus channel**: `SetLimit` counts goroutines and blocks
  the spawner. `semaphore.Weighted` adds weights and a context-aware `Acquire`; its
  FIFO queue protects large requests at the cost of head-of-line blocking. A buffered
  channel needs no dependency and is enough for a fixed slot count.
- **Cancellation is cooperative**: `errgroup` cancels a context, it cannot stop code
  that ignores it (the 300 ms above). Every blocking call in a task must take `ctx`.
- **singleflight is not a cache**: it merges concurrent calls only, shares errors with
  every waiter and runs under one caller's context. Put a cache behind it, detach the
  context, and call `Forget` when a failed result should not be shared.
- **Book versus today**: *Concurrency in Go* (2017) predates `context.Cause` (Go 1.20),
  `context.WithoutCancel` (1.21) and `WaitGroup.Go` (1.25); its patterns hold, and
  these APIs replace parts that had to be written by hand.

## Documentation Links

- [Go Concurrency Patterns: Pipelines and cancellation, The Go Blog](https://go.dev/blog/pipelines): doc
- [Package context (WithCancelCause, Cause, WithoutCancel), pkg.go.dev](https://pkg.go.dev/context): doc
- [Package errgroup, golang.org/x/sync](https://pkg.go.dev/golang.org/x/sync/errgroup): doc
- [Package semaphore, golang.org/x/sync](https://pkg.go.dev/golang.org/x/sync/semaphore): doc
- [Package singleflight, golang.org/x/sync](https://pkg.go.dev/golang.org/x/sync/singleflight): doc
- [sync.WaitGroup.Go, pkg.go.dev](https://pkg.go.dev/sync#WaitGroup.Go): doc
- [Go 1.25 Release Notes: WaitGroup.Go and the waitgroup vet analyzer, go.dev](https://go.dev/doc/go1.25): doc
- [Katherine Cox-Buday, Concurrency in Go, O'Reilly 2017](https://www.oreilly.com/library/view/concurrency-in-go/9781491941294/): book

---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

The Go memory model (version of June 6, 2022, published with Go 1.19) says when
a read in one goroutine is guaranteed to see a write from another. Its core
promise is DRF-SC: a program without data races behaves as if all goroutines were
interleaved on one processor. This lesson covers the edges that create that order
(channels, mutexes, `sync.Once`, `WaitGroup`, atomics), then breaks the promise on
purpose to see what Go still guarantees for a racy program and where it stops:
word-sized values stay intact, interfaces tear and crash. Measured with Go 1.27.0
(`GOTOOLCHAIN=go1.27.0`, module line `go 1.27`) on an Apple M4 Max (14 cores,
arm64), macOS 27.0.1. Every count comes from at least 3 runs and the text only
claims what held in every run.

## Use Cases

- Reviewing a "lock-free" fast path (feature flag, hot-reloaded config): `atomic.Pointer`, `OnceValue` or a mutex?
- Reading a `-race` report and rejecting "it is a benign race" with evidence.
- Counters updated from many goroutines (`atomic.Int64` instead of `int64` plus `AddInt64`).
- Porting Java or C++ code: Go has only sequentially consistent atomics, no acquire/release or relaxed.

## Deep Dive

### Happens-before in one table

*Happens-before* is program order inside a goroutine plus *synchronized-before*
edges between goroutines. A *data race* is a write concurrent with another read or
write of the same location, unless all are atomic. The edges, from `go.dev/ref/mem` and the `sync` docs:

| Edge | Synchronized before |
|------|---------------------|
| `go f()` | the start of `f` (goroutine exit is synchronized before nothing) |
| send on a channel | the completion of the matching receive |
| `close(ch)` | a receive that returns the zero value because `ch` is closed |
| receive on an unbuffered channel | the completion of the matching send |
| k-th receive on a channel of capacity C | the completion of send k+C (a counting semaphore) |
| call n of `mu.Unlock()` | the return of call m of `mu.Lock()`, for n < m |
| return of `f` in `once.Do(f)` | the return of every `once.Do(f)` |
| `wg.Done()`, or return of `f` in `wg.Go(f)` | the return of the `Wait` it unblocks |
| atomic op A whose effect B observes | B; all atomics form one sequentially consistent order |

### A racy counter and the race detector

```go
var plain int64
var typed atomic.Int64
var wg sync.WaitGroup
for range 8 {
	wg.Go(func() {
		for range 100_000 {
			plain++      // read-modify-write, not atomic
			typed.Add(1) // sequentially consistent atomic
		}
	})
}
wg.Wait()
fmt.Println("plain:", plain, "atomic:", typed.Load())
```

```text
$ go run ./counter              (two runs)
plain: 112185 atomic: 800000
plain: 113722 atomic: 800000
$ go run -race ./counter        (paths trimmed)
WARNING: DATA RACE
Read at 0x00c00019e030 by goroutine 11:
  main.main.func1()   counter/main.go:16
Previous write at 0x00c00019e030 by goroutine 8: ...
Found 2 data race(s)
exit status 66
```

Six of every seven increments were lost; 66 is the detector's default `exitcode`.

### Weak memory on real hardware: two litmus tests

Store buffering: each goroutine stores one variable, then loads the other. Under
sequential consistency at least one must read 1. Each round, main resets the
variables, releases both goroutines through an atomic barrier and checks the
outcome after both report back (1,000,000 rounds):

```go
case first:  x = 1; r1 = y          // plain int32
default:     y = 1; r2 = x
// atomic version: ax.Store(1); r1 = ay.Load()  and  ay.Store(1); r2 = ax.Load()
```

```text
plain  int32: r1==0 && r2==0 in 498237 of 1000000 rounds
atomic.Int32: r1==0 && r2==0 in 0 of 1000000 rounds
(flag,data): map[[0 0]:4987472 [0 1]:2906 [1 0]:44 [1 1]:9578]
```

Across 8 runs the plain outcome ranged from 130,614 to 528,280; the atomic one
was always 0. The last line is message passing (`data = 1; flag = 1` against
`r1 = flag; r2 = data`, 5,000,000 rounds): the forbidden `flag=1, data=0` showed
up in 10 of 11 runs, 6 to 53 times per run.

`go build -gcflags=-S` shows the compiler kept program order (`MOVD R1, main.data`
then `MOVD R1, main.flag`; the reader loads `flag` then `data`), so the reordering
came from the arm64 core, not from the compiler.

### What the compiler may do with a race

```go
var ticks int
go func() { for { ticks++ } }() // no synchronization, never exits
time.Sleep(100 * time.Millisecond)
fmt.Println("ticks after 100ms:", ticks) // ticks after 100ms: 0   (3 of 3 runs)
```

The goroutine compiled to a bare `HINT $0` and a jump back: the increment was
deleted, since nothing synchronizes with that loop. The opposite case exists too:
a `for !ready {}` busy wait on a plain `bool` finished in 3 of 3 runs because Go
1.27 reloads `main.ready` each iteration (`MOVBU main.ready(SB), R1; TBZ`). The
docs say that loop "is not guaranteed to finish" and `-race` reports it. Working
today because of an optimizer detail is not the same as correct.

### What a racy program still guarantees, and where it stops

A read of a single-word or smaller location must observe a value actually written
to it, and out-of-thin-air values are disallowed (that one is doc-only: an absence
cannot be observed). A writer flipping an `int64` between `0` and `-1` (all bits
set) for one second gave `map[-1:42363463 0:81054537]`: in 3 runs, nothing else.

Values larger than a word get no such promise. An interface is two words
(itab and data), and the writer stores them one at a time:

```go
type Getter interface{ Get() int }
type A struct{ v int }
type B struct{ v int }
func (a *A) Get() int { return a.v }      // &A{1} -> 1
func (b *B) Get() int { return b.v * 10 } // &B{2} -> 20

// writer: shared = a / shared = b, alternating until an atomic stop flag
// reader: counts[shared.Get()]++ for one second
```

```text
map[1:16673637 2:15410192 10:11677999 20:12073172]
map[1:21992373 2:17146744 10:10330789 20:12848094]
```

`2` is `A.Get` on `B`'s data, `10` is `B.Get` on `A`'s data: in three runs 44 to
52% of reads saw a value no write produced. The writer's assembly is
`MOVD R3, main.shared(SB)`, a write-barrier check, then `MOVD R0, main.shared+8(SB)`.
Give `B` a pointer field (`Get` returns `*b.p`) and the tear crashes, 3 of 3 runs:

```text
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x2 addr=0x1 pc=0x102adb544]
```

`addr=0x1` is `A{1}`'s integer used as `B`'s pointer. Slices (3 words) and strings
(2 words) are exposed the same way: the "arbitrary memory corruption" the model warns about.

### sync/atomic: sequentially consistent and typed

Go 1.19 added `atomic.Bool`, `Int32`, `Int64`, `Uint32`, `Uint64`, `Uintptr` and
`Pointer[T]` (`And`/`Or` came in 1.23); its notes say Go "only provides sequentially
consistent atomics". Swapping the interface through one pointer fixes the tear:

```go
var shared atomic.Pointer[Getter]
// writer: shared.Store(&a) / shared.Store(&b); reader: (*shared.Load()).Get()
// output: map[1:85045272 20:32697728]   (3 runs; -race: no report)
```

`atomic.Value` cannot do this swap, because every `Store` must use one concrete type:
`sync/atomic: store of inconsistently typed value into Value`. Typed atomics also
forbid mixed plain access, and vet catches the classic misuses:

```text
$ go build ./compileerr      (var hits atomic.Int64; hits++)
compileerr/main.go:7:2: invalid operation: hits++ (non-numeric type atomic.Int64)
$ go vet ./vetdemo
vetdemo/main.go:14:2: direct assignment to atomic value
vetdemo/main.go:10:17: snapshot passes lock by value: example.com/mm/vetdemo.Stats contains sync/atomic.Int64 contains sync/atomic.noCopy
```

Per the docs, `Int64`/`Uint64` are 64-bit aligned even on 32-bit platforms, where
`AddInt64` and friends need manual alignment (not testable on arm64).

### Double-checked initialization: broken and fixed

```go
func getBroken() *Config {
	if !loaded { // plain bool read outside the lock
		mu.Lock()
		if !loaded {
			cfg = &Config{Port: 8080}
			loaded = true
		}
		mu.Unlock()
	}
	return cfg
}
```

Four goroutines under `-race`: `Found 3 data race(s)`. As a litmus test (2,000,000
rounds, 3 runs) it never returned `nil` here, which proves nothing: the message-passing
test shows this core reordering that shape, and the model allows `loaded == true`
with `cfg == nil`. Two correct versions:

```go
var getConfig = sync.OnceValue(func() *Config { return &Config{Port: 8080} })

var ptr atomic.Pointer[Config] // the flag IS the pointer
func getAtomicDCL() *Config {
	if c := ptr.Load(); c != nil {
		return c
	}
	ptrMu.Lock()
	defer ptrMu.Unlock()
	if ptr.Load() == nil {
		ptr.Store(load())
	}
	return ptr.Load()
}
```

`b.RunParallel` with 14 goroutines (wall time per call, 5 runs each): `OnceValue`
0.20 to 0.21 ns/op, atomic DCL 0.17 to 0.18 ns/op, a mutex around the check 107 to 110 ns/op.

## Trade-offs

- **OnceValue versus Once on failure**: called twice with a loader that panics,
  `Once.Do` printed `panic: config file missing` and then `returned, cfg = <nil>`:
  a panic counts as a return and the value stays zero silently. `OnceValue`
  panicked both times, and `OnceValues` returned the cached error both times. None
  retries; for "retry until it works" use `atomic.Pointer` plus a mutex.
- **Atomics versus a mutex**: an atomic orders one variable. Two fields that must
  change together need a mutex, or one `atomic.Pointer` to an immutable struct.
- **atomic.Pointer[T] versus atomic.Value**: `Pointer[T]` is checked at compile time;
  `Value` panics on a different concrete type or on `nil`.
- **The race detector**: per the docs it only finds races that execute, at 5 to 10x
  memory and 2 to 20x time. Run tests with `-race` in CI, plus a canary when coverage is thin.
- **"Benign" races**: the deleted stores and the torn interface are both legal
  outcomes. The model's advice: "If you must read the rest of this document to
  understand the behavior of your program, you are being too clever. Don't be clever."
- **No relaxed atomics**: simpler to reason about, but contention still costs. One
  `atomic.Int64` hammered by 14 goroutines: 48 ns/op; per-goroutine shards padded
  to the 128-byte line (`hw.cachelinesize`): 0.15 ns/op (5 runs each). Shard hot counters.

## Documentation Links

- [The Go Memory Model, go.dev](https://go.dev/ref/mem): doc
- [Package sync/atomic, pkg.go.dev](https://pkg.go.dev/sync/atomic): doc
- [Package sync (Once, OnceValue, WaitGroup, Mutex), pkg.go.dev](https://pkg.go.dev/sync): doc
- [Go 1.19 Release Notes: memory model revision and atomic types, go.dev](https://go.dev/doc/go1.19): doc
- [Data Race Detector, go.dev](https://go.dev/doc/articles/race_detector): doc
- [Adve and Boehm, Memory Models: A Case for Rethinking Parallel Languages and Hardware, CACM 2010](https://doi.org/10.1145/1787234.1787255): paper
- [Russ Cox, Updating the Go Memory Model, research.swtch.com (complement to the Go Memory Model)](https://research.swtch.com/gomm): doc

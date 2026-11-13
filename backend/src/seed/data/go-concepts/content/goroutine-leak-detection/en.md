---
version: 1.0
updatedAt: 2026-11-13
---
## Objective

A goroutine leak is a goroutine blocked forever on a channel or `sync` primitive that nothing can
unblock; it pins its stack and all it references, so the service grows until restarted. Go 1.27
makes the `goroutineleak` profile generally available: on demand, the GC proves which blocked
goroutines can never wake up, and `runtime/pprof` (or `/debug/pprof/goroutineleak`) reports them.

This lesson leaks goroutines on purpose, reads the profile, explains its reachability algorithm
(Saioc et al., ASPLOS 2025), shows the blind spots plus one false negative the docs do not
mention, compares it with the goroutine profile and `go.uber.org/goleak`, and measures its cost.
Measured with `go1.27.0 darwin/arm64` on an Apple M4 Max (14 cores, macOS) and `goleak v1.3.0`;
every output is from 3 or more runs and only what was stable is claimed.

## Use Cases

- Proving a climbing goroutine count is a leak, not a traffic spike, with the blocking line.
- Exporting a periodic leak profile next to the CPU and heap profiles a service already has.
- Catching leaks in CI with `goleak`, and knowing which ones only goleak can see.
- Auditing fan-out code: early return on error, `select` with timeout, a forgotten `Stop`.

## Deep Dive

### A leak the GC can prove

The classic shape: results go into an unbuffered channel, the collector returns on first error.

```go
func processAll(items []int) ([]int, error) {
	ch := make(chan result) // unbuffered; result is struct{ n int; err error }
	for _, it := range items {
		go func() {
			n, err := work(it) // work(3) fails at once, the others sleep 1 ms
			ch <- result{n, err}
		}()
	}
	var out []int
	for range items {
		r := <-ch
		if r.err != nil {
			return nil, r.err // the other senders block forever
		}
		out = append(out, r.n)
	}
	return out, nil
}
```

`main` starts 4 pool workers ranging over a `jobs` channel it still holds, calls `processAll` 10
times with 10 items, then `pprof.Lookup("goroutineleak").WriteTo(f, 0)` (a leak-detecting GC):

```text
NumGoroutine: 95
goroutine profile count: 95
goroutineleak profile count: 90
NumGoroutine after detection: 95
```

90 is 10 calls times 9 stuck senders. The 4 pool workers are blocked too, but on a channel a
running goroutine can still reach. `NumGoroutine` stays at 95: the runtime reports leaks and
frees nothing (the Golf paper also describes recovery; the shipped profile only reports).

```text
$ curl -s 'localhost:6060/debug/pprof/goroutineleak?debug=1'
goroutineleak profile: total 144
144 @ 0x104ec0688 0x104e518a4 0x104e514b8 0x10506bc68 0x104ec76a4
#	0x10506bc67	main.processAll.func1+0x97	./main.go:30
```

That is a server variant looping over `processAll` with `import _ "net/http/pprof"` (no flag
needed in 1.27); `go tool pprof -list processAll.func1` puts them all on line 30. `debug=2` dumps
every goroutine in panic format, leaked ones with a new status: `goroutine 39 [chan send
(leaked)]:`. Measured: only writing the profile runs a detection cycle, and `Profile.Count()`
returns the last cycle's result (0 before the first), so the `/debug/pprof/` index can be stale.

### How detection works

From the proposal design doc (74609) and `runtime/mgc.go` in go1.27.0:

1. Marking starts from globals and only the goroutines that may still run, not every stack.
2. Pointers from a blocked goroutine's `sudog` to its channel or `sync` object are untraceable
   for the cycle, so a goroutine does not keep its own channel alive.
3. When marking ends, each blocked goroutine whose primitive got marked becomes a root and
   marking resumes, until nothing new is promoted.
4. The rest switch to `_Gleaked` and are reported; their stacks are then marked, so the cycle
   frees nothing they reference.

The per-goroutine check (`isMaybeRunnable`) treats `select {}` and nil-channel operations as
never runnable, checks channel, `select`, `Cond`, `WaitGroup`, `Mutex` and `RWMutex` waits
against the mark bits, and returns "maybe runnable" for anything else (sleep, I/O wait). The
design doc states the approach is sound ("there are no false positives"): a primitive no
runnable code can reach can never be operated on again.

### Blind spot: a global or a live goroutine still reaches it

The release notes warn that leaks on primitives reachable "through global variables or the local
variables of runnable goroutines" may be missed. The same 10 stuck senders, three ways:

```go
ch := make(chan int)
for i := range 10 {
	go func(c chan int, v int) { c <- v }(ch, i) // ch by value: ch = nil below cannot race
}
switch mode {
case "global":
	lastCh = ch // a package-level var chan int
case "runnable": // a monitor sleeping in a loop, holding ch in a local
	go func(c chan int) {
		for {
			time.Sleep(time.Second)
			_ = len(c)
		}
	}(ch)
}
ch = nil
```

```text
local    NumGoroutine=11 goroutineleak=10
global   NumGoroutine=11 goroutineleak=0
runnable NumGoroutine=12 goroutineleak=0
```

The senders are equally stuck in all three; only reachability changed. A sleeping goroutine counts
as runnable, so any long-lived goroutine holding a reference hides the leak. Capturing `ch` instead
(`go func(v int) { ch <- v }(i)`) spoils the test: senders that had not run before `ch = nil` send
on a nil channel, leaked by definition, and global and runnable showed 6 to 10.

### A false negative the docs do not mention

While building these examples, `go func() { ch <- i }()` leaks were never reported. Four ways to
send from 10 goroutines that all leak:

```go
go func() { ch <- i }()       // captured:  newly leaked 0
go func() { ch <- i + 1 }()   // computed:  newly leaked 10
go func(v int) { ch <- v }(i) // param:     newly leaked 10
go func() { ch <- 42 }()      // constant:  newly leaked 10
```

The arm64 assembly of the `captured` closure (`go build -gcflags=-S`) explains it:

```text
main.captured.func1:
	ADD	$16, R26, R1      // elem = &closure.i (R26 is the closure context)
	MOVD	8(R26), R0        // ch, loaded from the same closure object
	CALL	runtime.chansend1(SB)
```

A send passes the value by address; here it points into the heap closure, which also holds `ch`.
For channel waits the detector hides `sudog.c` but leaves `sudog.elem` traceable, so the GC walks
goroutine, `sudog`, closure, channel and marks the channel. The other variants send from a stack
temporary. Measured on go1.27.0 darwin/arm64 and absent from the blog, release notes and design
doc: read an empty profile as "no proven leak", never as "no leak".

### Goroutine profile versus leak profile

The plain `goroutine` profile of the first program:

```text
goroutine profile: total 95
90 @ 0x104c13f48 0x104bae224 0x104bade38 0x104c68788 0x104c1a054
#	0x104c68787	main.processAll.func1+0x97	./main.go:30
4 @ 0x104c13f48 0x104baf0e0 0x104baec54 0x104c687d4 0x104c1a054
#	0x104c687d3	main.startPool.func1+0x33	./main.go:47
```

Both groups park in channel operations and nothing says which is the bug: the blog calls
goroutine profiles "a rudimentary way" that cannot tell a leak from blocking by design. Uber's
LeakProf (CGO 2024) mined these profiles with heuristics and still found 24 production leaks
(21 fixed, up to 34% speedup and 9.2x less memory in some services).

### goleak in tests

`goleak` lists all goroutines when a test ends and fails if unexpected ones remain:

```go
func TestLeaky(t *testing.T) {
	defer goleak.VerifyNone(t)
	ProcessAll(items, false) // TestFixed passes true: make(chan result, len(items))
}

var events = make(chan string) // package-level

func StartAudit() { go func() { for range events {} }() }

func TestAudit(t *testing.T) {
	defer goleak.VerifyNone(t)
	StartAudit()
}
```

```text
--- FAIL: TestLeaky (0.44s)
    work_test.go:18: found unexpected goroutines:
        [Goroutine 8 in state chan send, with example.com/goleaktest.ProcessAll.func1 on top of the stack:
         Goroutine 9 in state chan send, with example.com/goleaktest.ProcessAll.func1 on top of the stack:
--- PASS: TestFixed (0.00s)
$ go test -run '^TestAudit$' .
--- FAIL: TestAudit (0.45s)
    work_test.go:32: found unexpected goroutines:
        [Goroutine 6 in state chan receive, with example.com/goleaktest.StartAudit.func1 on top of the stack:
```

Stacks are trimmed: goleak v1.3.0 lists each of the 9 senders with its own stack, ungrouped.
`TestFixed` also passes `goleak.IgnoreCurrent()`; without it, it failed too, because `VerifyNone`
sees the whole process, including the 9 goroutines `TestLeaky` left. The 0.44 s is goleak
retrying (20 retries, back-off up to 100 ms). After `ProcessAll` plus `StartAudit` the runtime
profile reported `goroutineleak count = 9`: the audit consumer waits on a global channel, so only
goleak flags it. Per the CGO 2024 paper, goleak found 857 pre-existing leaks in a 75-million-line
monorepo and prevented about 260 new ones in a year.

### What a detection cycle costs

Ordinary leaks (n leaked goroutines over separate channels, 5 runs) and the blog's "daisy chain"
worst case (goroutine i waits on channel i and holds channel i+1, head in a global, nothing
leaked, so each round of step 3 promotes one goroutine; 3 runs):

```text
n=10000   runtime.GC 2.5 to 3.5 ms   goroutineleak 7.8 to 8.3 ms   goroutine 4.8 to 5.0 ms
n=100000  runtime.GC 25 to 26 ms     goroutineleak 80 to 82 ms     goroutine 51 to 52 ms
chain n=1000    runtime.GC ~0.4 ms     goroutineleak 30 to 34 ms
chain n=4000    runtime.GC ~2 ms       goroutineleak 155 to 169 ms
chain n=16000   runtime.GC 4 to 6 ms   goroutineleak 1.31 to 1.36 s
```

`runtime/metrics` counted 16003 stop-the-world pauses in the 16000 cycle (one per round), none in
a bucket above 0.92 ms; `GODEBUG=gctrace=1` tags it `(checking for goroutine leaks)`.

## Trade-offs

- **Sound, not complete**: no false positives by design, but a leak on anything still reachable
  (globals, a sleeping goroutine's locals, the captured-variable case) is invisible, and it names
  the blocked line, not the missing `return` or `close`. Pair it with `goleak`, as the blog says.
- **Only channels and `sync`**: according to the blog, goroutines blocked on file or network I/O,
  raw syscalls or custom primitives are never reported (doc only, not measured here).
- **On demand, with a pathological case**: ordinary leaks cost 2x to 3x a GC, but long chains of
  dependent goroutines cost seconds of marking and thousands of short pauses. The blog suggests
  sampling periodically (for example every 4 hours), since a leak stays visible once it happens.
- **goleak sees the process, not the test**: it reports every lingering goroutine, legitimate
  background ones included (filter with `IgnoreTopFunction` or `IgnoreCurrent`), and its docs say
  `VerifyNone` is incompatible with `t.Parallel`; use `VerifyTestMain` there.
- **Earlier versus today**: Go 1.26 shipped the profile behind
  `GOEXPERIMENT=goroutineleakprofile`; Go 1.27 deleted that setting and turned the profile on.

## Documentation Links

- [Goroutine Leak Profiles, The Go Blog](https://go.dev/blog/goroutine-leak-profiles): doc
- [Go 1.27 Release Notes: Goroutine leak profile](https://go.dev/doc/go1.27): doc
- [Proposal 74609: Goroutine leak detection via garbage collection](https://go.googlesource.com/proposal/+/HEAD/design/74609-goroutine-leak-detection-gc.md): doc
- [runtime/pprof package documentation](https://pkg.go.dev/runtime/pprof): doc
- [net/http/pprof package documentation](https://pkg.go.dev/net/http/pprof): doc
- [go.uber.org/goleak package documentation](https://pkg.go.dev/go.uber.org/goleak): doc
- [Dynamic Partial Deadlock Detection and Recovery via Garbage Collection, ASPLOS 2025](https://doi.org/10.1145/3676641.3715990): paper
- [Unveiling and Vanquishing Goroutine Leaks in Enterprise Microservices, CGO 2024](https://arxiv.org/abs/2312.12002): paper

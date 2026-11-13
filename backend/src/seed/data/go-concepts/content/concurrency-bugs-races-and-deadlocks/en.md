---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Tu et al. (ASPLOS 2019) classified 171 fixed bugs from Docker, Kubernetes, etcd, gRPC, CockroachDB
and BoltDB by behavior (blocking or not) and cause (shared memory or message passing). Chabbi and
Ramanathan (PLDI 2022) labeled 1,011 races fixed in Uber's Go monorepo. This lesson reproduces their
recurring patterns with the real `-race` report, runtime fatal error or `go vet` message, and the fix.

All output comes from Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, module line `go 1.27` unless a section says
otherwise) on an Apple M4 Max with macOS (darwin/arm64). In race reports, paths are shortened to
`...` and goroutine creation stacks are cut.

## Use Cases

- Deciding what `go test -race` in CI will and will not catch, and where `go vet` covers the gap.
- Reviewing goroutine code against the patterns that produced most real bugs.
- Reading a `WARNING: DATA RACE` report or a `fatal error` dump during an incident.
- Arguing channels versus mutexes with data instead of slogans.

## Deep Dive

### What real projects get wrong

Tables 5, 6 and 9 of Tu et al., the 171 bugs on both axes:

| cause | blocking | non-blocking | total |
|---|---|---|---|
| shared memory | 36 (Mutex 28, RWMutex 5, Wait 3) | 69 | 105 |
| message passing | 49 (Chan 29, Chan with other ops 16, Lib 4) | 17 | 66 |
| total | 85 | 86 | 171 |

"Blocking" is wider than deadlock: it includes goroutines waiting for a message nobody sends. About
58% of blocking bugs came from message passing, against the belief that channels are safer, while
about 80% of non-blocking bugs came from shared memory. On their reproduced bugs the runtime
deadlock detector caught 2 of 21 blocking ones, the race detector 10 of 20 non-blocking ones.

The Uber study adds scale: about 46 million lines, 2,100 services, a median of 2,048 goroutines per
Go process versus 256 threads per Java one, about 2,000 races found in six months. Its Tables 2 and
3 count the 1,011 fixed races by root cause (labels overlap): missing or partial locking 470,
concurrent slice access 391, thread-safe APIs violating their contract 369, parallel table-driven
tests 139, capture by reference 121 (48 loop variables, 50 `err` variables), maps 38, value versus
pointer confusion 38, group synchronization 24.

### Loop variable capture: go 1.21 versus go 1.22

```go
for i := 0; i < 4; i++ {
	wg.Add(1)
	go func() {
		defer wg.Done()
		mu.Lock()
		seen[i]++ // which i?
		mu.Unlock()
	}()
}
```

```text
$ go run .        # go.mod says go 1.21; 20 of 20 runs
map[4:4]
$ go run -race .
WARNING: DATA RACE
Read at 0x00c000012150 by goroutine 6:
  main.main.func1()
      .../loop121/main.go:17 +0x80

Previous write at 0x00c000012150 by main goroutine:
  main.main()
      .../loop121/main.go:12 +0xa8
...
Found 1 data race(s)
exit status 66
$ go vet .
main.go:17:9: loop variable i captured by func literal
$ go run -race .  # same file, go.mod says go 1.22
map[0:1 1:1 2:1 3:1]
```

Same 1.27 toolchain, different result: the module's `go` line picks the semantics. Since 1.22 each
iteration gets a new variable and vet stays silent. The race is `i++` (line 12) against the read in
the goroutine. Captured `err` variables (50 of Uber's races) are not loop variables: still shared.

### Concurrent map writes: a fatal error, not a panic

```go
hits := map[string]int{}
for w := range 8 {
	wg.Go(func() {
		for i := range 100_000 {
			hits[string(rune('a'+(w+i)%26))]++
		}
	})
}
```

```text
fatal error: concurrent map writes

goroutine 20 [running]:
```

Exit status 2 in 5 of 5 runs; a `defer func() { recover() }()` in each goroutine changed nothing,
because a fatal error kills the process. The check is best effort: two goroutines doing 10
increments each printed `map[k:20]` in 200 of 200 runs, while `-race` reported the race inside
`runtime.mapaccess1_faststr`. Use a `sync.Mutex` around the map, or `sync.Map` for mostly-read keys.

### Appending to a shared slice without a lock

```go
var results []int
for i := range 1000 {
	wg.Go(func() { results = append(results, i) }) // no lock
}
wg.Wait()
fmt.Println("len:", len(results))
```

```text
$ for i in $(seq 10); do ./sa; done | tr '\n' ' '
len: 953 len: 850 len: 931 len: 999 len: 953 len: 866 len: 849 len: 874 len: 881 len: 963
$ go run -race . 2>&1 | tail -3
len: 670
Found 4 data race(s)
exit status 66
```

No crash, just lost elements: 1 to 151 of 1,000 per run. Two goroutines read the same slice header,
both append, one write wins; `-race` pointed at line 13 for both the write and the earlier read. A
mutex around the `append`, or a preallocated `make([]int, 1000)` where goroutine `i` writes only
`results[i]`, both printed 1,000 with a clean `-race` run.

### WaitGroup.Add inside the goroutine

```go
for i := range results { // 100 slots
	go func() {
		wg.Add(1) // too late: Wait may already have seen zero
		defer wg.Done()
		results[i] = true
	}()
}
wg.Wait()
```

```text
$ go vet .
wgadd/main.go:13:10: WaitGroup.Add called from inside new goroutine
$ go run .
done when Wait returned: 93
```

Over 10 runs `Wait` returned with 83 to 98 of the 100 goroutines finished, and `-race` reported the
write at line 15 against `main`'s read at line 20. Tu et al. found 6 bugs from this rule ("Add has to
be invoked before Wait"), one in etcd. The `waitgroup` vet analyzer is new in Go 1.25, as is
`WaitGroup.Go`, which calls `Add` before starting the goroutine: the `wg.Go` loops here cannot have it.

### Sending on a channel nobody receives

```go
ch := make(chan int)
ch <- 1 // nobody will ever receive
```

```text
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [chan send]:
main.main()
	.../deadlock/main.go:7 +0x38
exit status 2
```

The runtime says this only when every goroutine is blocked. Figure 1 of Tu et al., a Kubernetes bug,
is the realistic shape: a child sends its result on an unbuffered channel while the parent `select`s
on it and on `time.After`. When the timeout wins, the child blocks forever:

```go
ch := make(chan int)      // fix: make(chan int, 1)
go func() { time.Sleep(2 * time.Millisecond); ch <- 42 }()
select {
case r := <-ch: return r, true
case <-time.After(timeout): return 0, false // 1 ms timeout, 1,000 calls
}
```

```text
buffered=false goroutines still alive: 1001
buffered=true goroutines still alive: 1
```

1,000 leaked goroutines, exit status 0, no word from the runtime (5 of 5 runs). Partial deadlocks
like this are what the goroutine leak profile and `goleak` are for.

### A mutex copied by value

```go
type Counter struct{ mu sync.Mutex; n map[string]int }
func (c Counter) Inc(k string) { // value receiver: locks a copy of mu
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n[k]++ // the map itself is shared
}
```

```text
$ go vet .
mutexcopy/main.go:13:9: Inc passes lock by value: bugs/mutexcopy.Counter contains sync.Mutex
$ go run .   # 4 goroutines, 1,000 Inc each
fatal error: concurrent map writes
```

Five of five runs crashed: each call locked its own copy, so nothing was excluded. With a pointer
receiver (`func (c *Counter) Inc`) vet is silent and `-race` prints `4000` with exit status 0.

### What the detector costs and what it misses

The same 4 x 1,000,000 locked increments, built normally and with `-race` (3 runs each):

| build | wall time | max RSS | binary |
|---|---|---|---|
| normal | 0.55 to 0.75 s | 4.8 to 5.0 MB | 2.4 MB |
| `-race` | 2.57 to 2.82 s | 28.8 to 34.8 MB | 3.1 MB |

About 4.5x time and 6x memory, inside the documented 2 to 20x and 5 to 10x. The docs add that it
only finds races on code paths that run, and `GORACE` `exitcode` defaults to 66, the status of every
racy run above. Uber ran it daily, post-facto, over more than 100,000 unit tests rather than as a
pull request gate: their 95th percentile test time went from 25 to about 100 minutes with it on.

Static analysis attacks the blocking side. GCatch (Liu et al., ASPLOS 2021) turns channel operations
into constraints for a solver; on 21 applications it found 149 previously unknown blocking bugs and
GFix generated patches for 124. Developers fixed 125 reported bugs, 87 by applying GFix's patch.

## Trade-offs

- **Run vet explicitly**: `go test` passed on a package with both a copied mutex and an `Add` inside
  a goroutine; `go vet` flagged both. The vet subset inside `go test` does not include them.
- **CI gate versus scheduled run**: gating every pull request keeps new races out but costs the 4.5x
  runtime measured above; Uber chose a daily run and filed bugs instead.
- **Channels are not automatically safer**: 58% of blocking bugs in Tu et al. were message passing.
  For every send, ask who receives, who closes, and what happens on timeout.
- **The deadlock message is the exception**: one live goroutine (a ticker, an HTTP server) hides
  every stuck one. Count goroutines in tests and profile leaks in production.
- **Raise the `go` line deliberately**: moving a module to 1.22 or later changes loop semantics in
  all its files, which fixes captures but can change code that relied on sharing.

## Documentation Links

- [Data Race Detector, Go documentation](https://go.dev/doc/articles/race_detector): doc
- [Understanding Real-World Concurrency Bugs in Go, Tu et al., ASPLOS 2019](https://songlh.github.io/paper/go-study.pdf): paper
- [A Study of Real-World Data Races in Golang, Chabbi and Ramanathan, PLDI 2022](https://arxiv.org/abs/2204.00764): paper
- [Automatically Detecting and Fixing Concurrency Bugs in Go Software Systems (GCatch and GFix), ASPLOS 2021](https://doi.org/10.1145/3445814.3446756): paper
- [Fixing For Loops in Go 1.22, The Go Blog](https://go.dev/blog/loopvar-preview): doc
- [Go 1.25 Release Notes: waitgroup analyzer and WaitGroup.Go](https://go.dev/doc/go1.25): doc
- [copylock analyzer, golang.org/x/tools](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/copylock): doc
- [The Go Memory Model](https://go.dev/ref/mem): doc

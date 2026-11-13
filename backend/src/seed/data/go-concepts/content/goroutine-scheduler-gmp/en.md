---
version: 1.0
updatedAt: 2026-11-13
---
## Objective

A goroutine is not a thread and `GOMAXPROCS` is not a thread count. This lesson
takes the scheduler as the runtime describes itself (the header of `runtime/proc.go`
and Dmitry Vyukov's 2012 design doc) and checks each mechanism with a program: G, M
and P; the `runnext` slot; local and global run queues and work stealing seen through
`GODEBUG=schedtrace`; asynchronous preemption (Go 1.14) against
`GODEBUG=asyncpreemptoff=1`; the P handoff when a thread blocks in a system call; the
netpoller; and the `/sched/*` metrics (expanded in Go 1.26). Measured with Go 1.27.0
(`GOTOOLCHAIN=go1.27.0`, module line `go 1.27`) on an Apple M4 Max (14 cores, 10
performance and 4 efficiency, arm64), macOS 27.0.1, 3 runs per program. Constants
such as the 10 ms time slice were read in the 1.27 source and are attributed to it.

## Use Cases

- Reading a `schedtrace` line in an incident: idle Ps while the global queue grows, or every P busy?
- Explaining why 100 goroutines in a raw `read(2)` cost 100 OS threads and 100 idle sockets cost none.
- Diagnosing latency from tight loops, and knowing what `asyncpreemptoff=1` really turns off.
- Exporting `/sched/latencies:seconds` and `/sched/goroutines/*` instead of guessing from `NumGoroutine`.
- Not depending on goroutine start order in tests (and why `-race` shuffles it).

## Deep Dive

### G, M and P

The header of `proc.go` in 1.27 is the whole vocabulary:

```text
// G - goroutine.
// M - worker thread, or machine.
// P - processor, a resource that is required to execute Go code.
//     M must have an associated P to execute Go code, however it can be
//     blocked or in a syscall w/o an associated P.
```

There are exactly `GOMAXPROCS` Ps. A P owns what running Go code needs: a local run
queue (a 256-slot ring, `runq [256]guintptr` in `runtime2.go`), a `runnext` slot and
the allocation cache. Ms are threads, and there can be far more Ms than Ps, because an
M blocked in the kernel does not need a P. Vyukov's design doc introduced P to fix four
problems of the Go 1.0 scheduler: one global mutex, goroutine handoff between threads,
a memory cache per M (the doc cites up to 100 Ms per M running Go code, each cache up to
2 MB) and aggressive thread blocking around syscalls. Design doc versus today: the doc
does not mention preemption or the netpoller, and its "try out LIFO scheduling" idea
is now the `runnext` slot.

### runnext: the newest goroutine runs first

```go
runtime.GOMAXPROCS(1)
for i := 1; i <= 10; i++ {
	wg.Go(func() {
		mu.Lock()
		order = append(order, i)
		mu.Unlock()
	})
}
wg.Wait() // main parks; the single P picks the next G
```

```text
run order: [10 1 2 3 4 5 6 7 8 9]
run order: [10 1 2 3 4 5 6 7 8 9]
run order: [10 1 2 3 4 5 6 7 8 9]
```

`go` puts the new G in `runnext` and kicks the previous occupant to the tail of the
local queue (`runqput` with `next=true`), so the last goroutine created runs first and
the rest run FIFO. The source explains the trade: a goroutine run from `runnext`
inherits the current time slice, which helps producer/consumer pairs, and sysmon must
preempt the pair if it ping-pongs forever. Under `-race` the runtime sets
`randomizeScheduler` and skips `runnext` half the time:

```text
run order: [5 1 2 4 3 6 7 8 9 10]
run order: [9 1 3 2 5 6 4 8 7 10]
run order: [9 2 3 4 5 1 7 6 8 10]
```

### Local and global queues, work stealing

1000 goroutines of about 0.6 ms of CPU each, spawned by one goroutine, with
`GOMAXPROCS=4 GODEBUG=schedtrace=10` (third run, lines cut):

```text
SCHED 14ms: gomaxprocs=4 idleprocs=4 threads=5 spinningthreads=0 needspinning=0 idlethreads=3 runqueue=0 [ 0 0 0 0 ] schedticks=[ 1 0 2 3 ]
SCHED 26ms: gomaxprocs=4 idleprocs=0 threads=5 spinningthreads=0 needspinning=1 idlethreads=0 runqueue=390 [ 113 112 112 201 ] schedticks=[ 19 18 20 20 ]
SCHED 100ms: gomaxprocs=4 idleprocs=0 threads=5 spinningthreads=0 needspinning=1 idlethreads=0 runqueue=160 [ 50 90 66 82 ] schedticks=[ 138 138 140 141 ]
SCHED 175ms: gomaxprocs=4 idleprocs=4 threads=5 spinningthreads=0 needspinning=0 idlethreads=3 runqueue=0 [ 0 0 0 0 ] schedticks=[ 250 250 252 253 ]
```

`runqueue` is the global queue and the brackets are the local queues (one earlier run
caught the spawner's P alone: `runqueue=517 [ 254 0 0 0 ]`). When the 256-slot ring is
full, `runqputslow` moves half of it plus the new G to the global queue in one batch.
Idle Ps take from there and steal from each other:
`runqgrab` takes half of a victim's queue, `stealWork` makes 4 passes over all Ps (the
last one may also take `runnext` and timers), and `findRunnable` checks the global
queue every 61st schedtick so two goroutines respawning each other cannot starve it.
The final schedticks summed to 1005, 1004 and 1005 in the three runs, 248 to 253 per
P: the load spread evenly, although only one P created work. To bound wasted CPU,
an M only starts spinning for work if spinning Ms are fewer than half the busy Ps
(`2*sched.nmspinning < gomaxprocs-sched.npidle`).

### Preemption: from function calls to signals

Before Go 1.14 a goroutine could only be switched at a function call (proposal 24543:
"and even then, not if the function is small or gets inlined"). A loop without calls:

```go
// spin has no function calls and no allocation: no cooperative preemption point.
func spin(n int) {
	s := 0
	for i := 0; i < n; i++ {
		s += i ^ (i >> 3)
	}
	sink = s
}

runtime.GOMAXPROCS(1)
go func() { spin(1_000_000_000); close(done) }()
time.Sleep(time.Millisecond) // phase 1: can main get the only P back?
// phase 2: GOMAXPROCS(2), spinner on the other P, then runtime.GC() must stop it
```

```text
$ ./preempt
spin alone: 301ms
GOMAXPROCS=1: main asked for 1ms, woke after 12ms
GOMAXPROCS=2: runtime.GC() took 300µs; worst GC stopping latency <= 10.24µs (before: <= 6.144µs)
$ GODEBUG=asyncpreemptoff=1 ./preempt
spin alone: 312ms
GOMAXPROCS=1: main asked for 1ms, woke after 302ms
GOMAXPROCS=2: runtime.GC() took 294.6ms; worst GC stopping latency <= 335.54432ms (before: <= 6.144µs)
```

With preemption on, main woke after 12, 3 and 23 ms and `runtime.GC()` took 200 to
300 µs; off, main woke after 302 to 306 ms and the GC took 289 to 296 ms: both waited
for the whole loop. The stopping latency is a `/sched/pauses/stopping/gc:seconds`
bucket bound, not an exact value. The mechanism, from the 1.27 source: `sysmon` runs
on its own M without a P, sleeping 20 µs and backing off to 10 ms when idle; `retake`
calls `preemptone` when a P has been on the same schedtick for
`forcePreemptNS = 10 * 1000 * 1000 // 10ms`. `preemptone` sets `stackguard0` to
`stackPreempt` (the cooperative check at the next call) and calls `preemptM`, which
sends `SIGURG`; the handler injects a call at a safe point. The spread fits: the
spinner started from `runnext` and inherited main's slice (3 ms), and an idle sysmon
checks less often (23 ms). The proposal rejected
compiler checks on loop back-edges because they cost 7.8% geomean on a benchmark suite.
The Go 1.14 notes list the cost of signals: more `EINTR` from slow syscalls made through
`syscall` or `x/sys/unix`. Per the runtime docs, `asyncpreemptoff=1` also disables
conservative scanning of asynchronously preempted stacks, which is why it is a GC
debugging knob.

### System calls: the P is handed off

```go
syscall.Pipe(p[:]) // blocking file descriptors: read(2) parks the thread
go func() {
	entered <- time.Now()
	buf := make([]byte, 1)
	syscall.Read(p[0], buf) // M blocks in the kernel holding the P
}()
t := <-entered
go func() { ran <- time.Now() }() // needs the P to run
```

With `GOMAXPROCS=1` the runnable goroutine ran 46, 32 and 54 µs after the read blocked.
In 1.27 a P has no syscall state any more (`_Psyscall_unused`: "A P is identified as
'in a system call' by looking at the goroutine's state"). `retake` takes the P from a
goroutine that stayed in the same syscall for "more than 1 sysmon tick (at least
20us)" and calls `handoffp`, which starts another M. If the P's queue is empty and
other Ps are idle or spinning, it waits up to 10 ms first.

### The netpoller: blocked goroutines without threads

Same program, 100 goroutines blocked on `os.Pipe` reads, then 100 in raw `syscall.Read`
on blocking pipes, sampling `runtime/metrics`:

```text
start                          threads=5    not-in-go=0    waiting=5    NumGoroutine=1
100 in os.File.Read (netpoll)  threads=5    not-in-go=0    waiting=105  NumGoroutine=101
100 in blocking read(2)        threads=102  not-in-go=100  waiting=5    NumGoroutine=101
after the reads returned       threads=103  not-in-go=0    waiting=5    NumGoroutine=1
```

Identical in all three runs. `os.Pipe` returns non-blocking descriptors registered
with kqueue: a reader parks as a waiting G and the netpoller (polled by idle Ms and
sysmon) readies it, so no thread is spent. Each raw `read(2)` held a thread, and the
threads stayed after the reads returned: idle Ms are kept for reuse, up to
`debug.SetMaxThreads` (10000 by default in `proc.go`). The `waiting=5` at start are
runtime goroutines that `NumGoroutine` does not count.

### Reading the scheduler: schedtrace, scheddetail, /sched/*

`GODEBUG=schedtrace=40,scheddetail=1` adds one line per P, M and G (cut):

```text
SCHED 103ms: gomaxprocs=4 idleprocs=0 threads=5 spinningthreads=0 needspinning=1 idlethreads=0 runqueue=287 gcwaiting=false nmidlelocked=0 stopwait=0 sysmonwait=false
  P0: status=1 schedtick=122 syscalltick=0 m=0 runqsize=94 gfreecnt=56 timerslen=0
  P3: status=1 schedtick=146 syscalltick=0 m=2 runqsize=89 gfreecnt=43 timerslen=0
  M2: p=3 curg=428 mallocing=0 throwing=0 preemptoff= locks=0 dying=0 spinning=false blocked=false lockedg=nil
  M1: p=nil curg=nil mallocing=0 throwing=0 preemptoff= locks=32 dying=0 spinning=false blocked=false lockedg=nil
  G1: status=4(sync.WaitGroup.Wait) m=nil lockedm=nil
  G17: status=4(GOMAXPROCS updater (idle)) m=nil lockedm=nil
  G152: status=1() m=nil lockedm=nil
```

For production, `runtime/metrics` in 1.27 lists 13 `/sched/*` metrics, including
`/sched/goroutines/{running,runnable,waiting,not-in-go}:goroutines`,
`/sched/goroutines-created:goroutines`, `/sched/threads/total:threads` (the 1.26 additions),
`/sched/latencies:seconds` (time runnable before running) and the
`/sched/pauses/{stopping,total}/{gc,other}:seconds` histograms. The Go 1.26 notes call
the thread metric `/sched/threads:threads`; reading that name returned `KindBad`
(kind 0) in all runs, the real name is `/sched/threads/total:threads`.

## Trade-offs

- **Async preemption is not free**: it bounds a tight loop at about 10 ms, but the
  process receives a `SIGURG` per preemption, and raw syscalls must retry on `EINTR`.
  `asyncpreemptoff=1` is a debugging switch: above it turned a 1 ms sleep into 302 ms.
- **Blocking syscalls and cgo cost a thread each**: 100 blocked `read(2)` calls made 102
  threads, which were kept after returning. Sockets, pipes and timers go through the
  netpoller; per the `os` source, regular files and directories are never registered
  with kqueue, so their reads hold a thread too.
- **runnext trades order for locality**: the newest goroutine runs first and shares the
  time slice. Tests that assume FIFO start order break, and `-race` makes that visible.
- **Spinning trades CPU for wake-up latency**: up to half the busy Ps' worth of Ms may
  spin before parking, which shows up as CPU use on an idle service.
- **Design doc versus today**: the 2012 doc describes P and stealing as they still work,
  but not `runnext`, async preemption, the netpoller loop or the 1.27 syscall path;
  read the header and code of `proc.go` for the current behavior.

## Documentation Links

- [runtime/proc.go at go1.27.0 (scheduler header comment and code), go.googlesource.com](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/runtime/proc.go): doc
- [Dmitry Vyukov, Scalable Go Scheduler Design Doc (2012), golang.org/s/go11sched](https://golang.org/s/go11sched): doc
- [Proposal 24543: Non-cooperative goroutine preemption, Austin Clements](https://go.googlesource.com/proposal/+/refs/heads/master/design/24543-non-cooperative-preemption.md): doc
- [Go 1.14 Release Notes: asynchronous preemption, go.dev](https://go.dev/doc/go1.14): doc
- [Go 1.26 Release Notes: new /sched metrics, go.dev](https://go.dev/doc/go1.26): doc
- [Package runtime/metrics, pkg.go.dev](https://pkg.go.dev/runtime/metrics): doc
- [Package runtime: GODEBUG schedtrace, scheddetail, asyncpreemptoff, pkg.go.dev](https://pkg.go.dev/runtime): doc

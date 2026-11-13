---
version: 1.0
updatedAt: 2026-11-13
---
## Objective

Go's collector is a concurrent, non-moving, non-generational tricolor mark-sweep
with two tuning knobs: `GOGC`, a ratio between GC CPU and heap memory, and
`GOMEMLIMIT`, a soft ceiling on the memory the runtime uses. This lesson explains
the collector from the hybrid write barrier proposal and the ISMM 2018 keynote,
reads a `GODEBUG=gctrace=1` line field by field, and measures one fixed workload
(4 GiB allocated as 64-byte pointerful nodes over a fixed live set) under `GOGC`
50, 100, 200 and off, under `GOMEMLIMIT` with `GOGC=off`, and into the death spiral
with the live heap near and above the limit, reading cycles, peak memory, GC CPU and
the CPU limiter from `runtime/metrics`. Measured with Go 1.27.0
(`GOTOOLCHAIN=go1.27.0`, module line `go 1.27`) on an Apple M4 Max (14 cores, arm64),
macOS 27.0.1, default `GOMAXPROCS` (14) unless stated, 3 runs per configuration.
Other benchmark jobs shared the machine, so wall and CPU times are ranges; cycle
counts and peaks are the stable numbers.

## Use Cases

- Choosing `GOGC` for a service knowing what each doubling costs in RAM and saves in CPU.
- Setting `GOMEMLIMIT` under a container memory limit and leaving headroom.
- Spotting a death spiral in metrics before the OOM kill or the latency page.
- Reading `gctrace` output pasted into an incident or an issue.
- Replacing a heap ballast (the pre-1.19 trick) with a memory limit.

## Deep Dive

### Concurrent tricolor marking and the hybrid write barrier

Objects are white (not reached), grey (reached, not scanned) or black (scanned).
Marking starts from roots (stacks, globals) and runs concurrently with the program;
sweeping is lazy. Since the mutator keeps writing pointers during marking, a write
barrier, enabled only while marking, keeps the collector from losing a reachable
object. Proposal 17503 (Go 1.8) replaced the Dijkstra insertion barrier with a hybrid:

```text
writePointer(slot, ptr):
    shade(*slot)
    if current stack is grey:
        shade(ptr)
    *slot = ptr
```

Shading the overwritten pointer (Yuasa style) and, while the stack is unscanned, the
new one (Dijkstra style) satisfies the weak tricolor invariant, so a scanned stack
stays black and the stop-the-world stack rescan disappears. It requires allocating
new objects black, which Go already did. The proposal aimed at worst-case STW under
50 µs. With a 384 MB live set (10 to 11 cycles per run), the longest STW phase in
`gctrace` was 0.07, 0.17 and 0.5 ms across 3 runs, while concurrent marking took up to
27 to 68 ms. Why not generational or moving? The keynote: a generational prototype's
always-on write barrier "was fast but it simply wasn't fast enough", and escape
analysis keeps young objects on the stack: "the young objects live and die young on
the stack".

### Reading a gctrace line

```text
gc 30 @0.595s 5%: 0.023+5.3+0.012 ms clock, 0.33+0.013/19/37+0.17 ms cpu, 139->143->75 MB, 152 MB goal, 0 MB stacks, 0 MB globals, 14 P
```

- `gc 30 @0.595s 5%`: cycle 30, 0.595 s after start, 5% of available CPU spent in
  GC so far by the runtime's own count.
- `0.023+5.3+0.012 ms clock`: STW sweep termination, concurrent mark, STW mark
  termination. The only pauses are the first and last numbers.
- `0.33+0.013/19/37+0.17 ms cpu`: the STW phases times 14 Ps, and marking split
  into assists (0.013, the allocating goroutine paying), dedicated workers (19) and
  idle workers (37, Ps with nothing else to do).
- `139->143->75 MB`: heap when the cycle started, when it ended (the program kept
  allocating during marking) and live after marking.
- `152 MB goal`: the guide's target, live + (live + roots) × GOGC/100, so 75 + 75
  plus rounding. The cycle started at 139 MB, before the goal: the pacer triggers
  early so marking ends before the heap reaches it.
- `0 MB stacks, 0 MB globals, 14 P`: the scannable roots and `GOMAXPROCS`.

### The workload

```go
type node struct {
	next    *node
	payload [7]int64 // 64 bytes in total
}

// half of the live set never changes; the other half is replaced at
// random and points into the fixed half, so replaced nodes become garbage
n := *liveMB << 20 / size / 2
...
for i := range total / *workers {
	x := &node{}
	x.payload[0] = int64(i)
	x.next = fixed[rand.IntN(n)]
	part[rand.IntN(len(part))] = x
}
```

The program reads `runtime/metrics` before and after the loop, and a goroutine
samples `/memory/classes/total:bytes` minus `/memory/classes/heap/released:bytes`
every millisecond: the quantity `GOMEMLIMIT` governs, according to the guide.

### GOGC: one dial between CPU and memory

`-live 64` (about 75 MB live with the two pointer slices), 1 allocating goroutine:

```text
GOGC  cycles   peak memory     GC CPU without idle workers, median (range)   wall, median
50    135-147  120-127 MB      3.62 s (2.76-8.99)                            2.88 s
100   62-64    158-165 MB      1.65 s (1.20-1.74)                            2.11 s
200   30       238-243 MB      0.79 s (0.59-0.79)                            1.67 s
off   0        4,421-4,424 MB  0                                             1.43 s
```

Each doubling of `GOGC` halved the cycles and the GC CPU and roughly doubled the
headroom above the live heap (about 50, 85 and 165 MB), which is the guide's rule.
`GOGC=off` kept all 4 GiB mapped. Idle workers added 1 to 5 s of CPU on Ps that were
idle anyway; `gctrace` and `/cpu/classes/gc/total` both include it.

### GOMEMLIMIT: a soft ceiling, not a cgroup

`GOGC=off GOMEMLIMIT=512MiB` lets the heap grow until total runtime memory nears the
limit. With 64 MB live: 11 cycles instead of 62 to 64, peak 488 to 490 MB:

```text
gc 1 @0.163s 0%: 0.070+9.2+0.013 ms clock, 0.98+0.13/23/37+0.18 ms cpu, 462->467->76 MB, 463 MB goal, 0 MB stacks, 0 MB globals, 14 P
```

The goal (459 to 464 MB in 3 runs) is the limit minus the memory the runtime uses
outside the heap. With a 192 MB live set the same setting ran 28 to 32 cycles at
490 to 491 MB, against 21 cycles at 454 to 463 MB with plain `GOGC=100`. The variable
takes `B`, `KiB`, `MiB`, `GiB` and `TiB` suffixes only; `GOMEMLIMIT=1GB` and
`GOMEMLIMIT=1gb` both killed the process at startup:

```text
fatal error: malformed GOMEMLIMIT; see `go doc runtime/debug.SetMemoryLimit`
```

### The death spiral and the 50% limiter

A limit below what the program needs makes the GC run back to back, each cycle
freeing little: the guide calls it thrashing. Same workload, 1 allocating goroutine,
`GOGC=off GOMEMLIMIT=512MiB`, growing live set (the real live heap is about 12%
above `-live`), 3 runs each:

```text
-live  cycles   peak memory  GC CPU (of which assists)  wall         limiter enabled
256    60-66    491-492 MB   3.1-3.5 s (0.00 s)         3.6 s        never
384    392-427  492-493 MB   28-31 s (1.0-1.5 s)        10.7-11.7 s  never
416    837-859  522-524 MB   63 s (0.03-0.04 s)         22.5-22.6 s  2 of 3 runs
512    687-696  637-639 MB   65 s (0.02-0.03 s)         22.9-23.1 s  3 of 3 runs
640    585-609  791-792 MB   69-71 s (0.02-0.05 s)      24.2-25.0 s  3 of 3 runs
```

With `GOGC=100` and no limit the same five rows took 7 to 16 cycles, 0.9 to 1.0 s of
GC CPU and 2.7 to 4.2 s. At 384 the limit held, for about 30 times the GC CPU and 3
times the wall time. From 416 up memory passed the limit, which is what soft means,
`/gc/limiter/last-enabled:gc-cycle` became nonzero in most runs, assists dropped to
almost nothing and the run stayed about 6 times slower. The goal collapses onto the
live heap, with a new cycle every 33 ms, 22 of them marking:

```text
gc 301 @9.588s 19%: 0.029+22+0.012 ms clock, 0.41+0.021/90/199+0.17 ms cpu, 581->594->582 MB, 581 MB goal, 0 MB stacks, 0 MB globals, 14 P
```

The guide says the limiter is "currently set at roughly 50%, with a 2 * GOMAXPROCS
CPU-second window", so that with a limit set too low "the program will slow down at
most by 2x". That bound did not hold here. In the source, `gcCPULimiter.limiting()`
is checked in two places only: mark assists (`mgcmark.go`) and scavenging at
allocation (`mheap.go`). Background workers keep running. With 14 allocating
goroutines (`-workers 14 -live 512`) the limited run took 7.2 s against 0.84 to
0.87 s, spent 12 s in assists, peaked at 735 to 823 MB and never enabled the limiter.

### runtime/metrics and runtime/debug

The metrics that matter for these knobs, all present in 1.27.0:

- `/gc/cycles/total:gc-cycles`, `/gc/heap/goal:bytes`, `/gc/heap/live:bytes`.
- `/gc/gogc:percent`, `/gc/gomemlimit:bytes`: the current settings.
- `/cpu/classes/gc/total:cpu-seconds` and its parts `mark/assist`, `mark/dedicated`,
  `mark/idle`, `pause`. The description calls it an overestimate, comparable only with
  other `/cpu/classes` metrics.
- `/gc/limiter/last-enabled:gc-cycle`: the proposal planned `/gc/throttles:events`;
  this is what shipped.

The setters return the previous value, and a negative limit reads without changing:

```go
fmt.Println("SetGCPercent(50) was   ", debug.SetGCPercent(50))
fmt.Println("SetMemoryLimit(-1) is  ", debug.SetMemoryLimit(-1)) // negative: read only
fmt.Println("SetMemoryLimit(256MiB) was", debug.SetMemoryLimit(256<<20))
fmt.Println("after:                 ", gauges())
debug.SetGCPercent(-1) // GOGC=off
debug.SetMemoryLimit(math.MaxInt64)
fmt.Println("off, no limit:         ", gauges())
```

```text
$ GOGC=200 GOMEMLIMIT=1GiB ./bin/knobs
start:                  /gc/gogc:percent=200 /gc/gomemlimit:bytes=1073741824
SetGCPercent(50) was    200
SetMemoryLimit(-1) is   1073741824
SetMemoryLimit(256MiB) was 1073741824
after:                  /gc/gogc:percent=50 /gc/gomemlimit:bytes=268435456
off, no limit:          /gc/gogc:percent=18446744073709551615 /gc/gomemlimit:bytes=9223372036854775807
```

`GOGC=off` shows up as the `uint64` of -1, and "no limit" is `math.MaxInt64`.

## Trade-offs

- **GOGC trades RAM for CPU linearly**: double it and GC CPU halves while headroom
  doubles (0.79 s and about 165 MB at 200 against 1.65 s and 85 MB at 100 above).
- **GOGC=off with a limit uses the memory you pay for**: 11 cycles instead of 64,
  but only while the live heap stays well below the limit. The guide suggests 5 to
  10% headroom for memory the runtime does not see, such as cgo allocations.
- **Soft means it can be exceeded**: the runtime gives up on the limit before it
  gives up all CPU. The container's OOM killer does not; keep the cgroup limit above
  `GOMEMLIMIT`.
- **The limiter caps GC's share, not your slowdown**: it only stops assists and
  allocation-time scavenging; dedicated workers, write barriers and sweeping go on.
- **Versus the JVM**: no generations and no compaction, by design (the keynote
  bets on escape analysis keeping short-lived values on the stack), and two knobs
  instead of a collector choice plus sizing flags.

## Documentation Links

- [A Guide to the Go Garbage Collector, go.dev](https://go.dev/doc/gc-guide): doc
- [Proposal: Eliminate STW stack re-scanning (hybrid write barrier), Clements and Hudson, 2016](https://go.googlesource.com/proposal/+/master/design/17503-eliminate-rescan.md): doc
- [Proposal: Soft memory limit, Knyszek, 2021](https://go.googlesource.com/proposal/+/master/design/48409-soft-memory-limit.md): doc
- [Getting to Go: The Journey of Go's Garbage Collector (ISMM 2018 keynote), The Go Blog](https://go.dev/blog/ismmkeynote): doc
- [Package runtime/metrics, pkg.go.dev](https://pkg.go.dev/runtime/metrics): doc
- [Package runtime/debug (SetGCPercent, SetMemoryLimit), pkg.go.dev](https://pkg.go.dev/runtime/debug): doc
- [Package runtime (GODEBUG gctrace format), pkg.go.dev](https://pkg.go.dev/runtime): doc
- [runtime/mgclimit.go at go1.27.0 (GC CPU limiter), Go source](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/runtime/mgclimit.go): doc
- [Dijkstra, Lamport, Martin, Scholten and Steffens, On-the-fly garbage collection, CACM 1978](https://doi.org/10.1145/359642.359655): paper

---
version: 1.0
updatedAt: 2026-11-13
---
## Objective

Green Tea is the mark algorithm that became Go's default in 1.26: instead of a
work list of objects, the collector keeps a queue of spans (8 KiB pages of
same-size objects) and scans every object marked on a span in one pass. This
lesson explains the design from the Go blog and the runtime source, checks which
opt-out really exists in Go 1.27.0 by building with it, and measures GC CPU per
cycle with and without Green Tea on three heap shapes (many small objects with
random pointers, one long chain, few large objects) plus an allocation-driven
service-like loop, then compares the result with the 10 to 40% the release notes
promise. Measured with Go 1.27.0 (`GOTOOLCHAIN=go1.27.0`, module line `go 1.27`)
on an Apple M4 Max (14 cores, arm64), macOS 27.0.1, at least 3 interleaved runs
per configuration. The machine was shared with other benchmark jobs, so CPU time per
cycle is the reported number, not wall time.

## Use Cases

- Upgrading a service to Go 1.26 or later and predicting whether GC CPU drops.
- A/B testing a suspected GC regression after the upgrade with `GOEXPERIMENT=nogreenteagc`.
- Choosing data layouts: many small pointerful objects versus large pointer arrays.
- Reading a vendor or blog claim about GC overhead against your own heap shape.

## Deep Dive

### The graph flood and why it stalls

Before Green Tea, marking was a graph flood: pop an object from a LIFO work list,
scan its pointers, push every newly marked object. The blog reports that about 90%
of GC cost is marking and that at least 35% of mark time is spent stalled on
memory, because consecutive objects on the work list live on unrelated pages. Each
scan is small and depends on the previous load, so the CPU cannot overlap misses.

### Green Tea: queue spans, not objects

The runtime source (`runtime/mgcmark_greenteagc.go` in 1.27.0) describes the core:
two bit sets per span, stored inline at the end of the span.

```go
type spanInlineMarkBits struct {
	scans [63]uint8         // scanned bits.
	owned spanScanOwnership // see the comment on spanScanOwnership.
	marks [63]uint8         // mark bits.
	class spanClass
}
```

Finding a pointer sets the object's bit in `marks` and enqueues the span, not the
object. The span queue is FIFO, so while a span waits, more of its objects get
marked. When the span is dequeued, `marks` minus `scans` gives the objects to scan,
and they are scanned in address order. A span can be queued several times per
cycle. Three details from the source matter for performance:

- **Size window**: `gcUsesSpanInlineMarkBits` is `heapBitsInSpan(size) && size >= 16`,
  and `heapBitsInSpan` means at most 512 bytes. Larger objects keep the old object path.
- **Single-object fast path**: `spanScanOwnership` records whether one or more marks
  arrived, so a span with one object skips the merge of the two bit sets.
- **Vector kernel**: the AVX-512 and GFNI scan code in `internal/runtime/gc/scan`
  exists only as `_amd64` assembly. On arm64 (this machine) the generic path runs,
  which is the configuration the blog's "10% to 40%, even without the vector
  enhancements" refers to.

### Which collector is in this binary? The opt-out in 1.27.0

The Go 1.26 notes say the opt-out "is expected to be removed in Go 1.27". It was
not: `internal/buildcfg/exp.go` in 1.27.0 still has `GreenTeaGC: true` in the
baseline, and the 1.27 notes do not mention Green Tea. Building both ways:

```bash
$ go build -o bin/gt-on ./gtbench
$ GOEXPERIMENT=nogreenteagc go build -o bin/gt-off ./gtbench
$ go version -m bin/gt-off | grep GOEXPERIMENT
	build	GOEXPERIMENT=nogreenteagc
$ GOEXPERIMENT=nogreentea go build -o /dev/null ./gtbench
go: unknown GOEXPERIMENT greentea
```

The default binary has no `GOEXPERIMENT` line at all, so its absence means Green
Tea. The setting is read by the compiler and linker only: running `gt-on` with
`GOEXPERIMENT=nogreenteagc` in the environment still measured 222 to 256 ms per
cycle on the graph heap, the Green Tea number.

### The benchmark: fixed heap, forced cycles

`gtbench` builds a live heap of about 256 MB, runs two warm-up `runtime.GC()` calls,
then forces 10 or 20 cycles (3 or 5 for the slow chain) and divides process CPU time
(`getrusage`) by the cycle count. A forced cycle marks and sweeps the whole heap,
so this is GC cost per cycle with nothing else running:

```go
case "graph": // small objects, 4 random pointers each
	n := mb << 20 / 64
	s := make([]*small, n)
	for i := range s {
		s[i] = &small{}
	}
	for _, x := range s {
		for j := range x.p {
			x.p[j] = s[r.IntN(n)]
		}
	}
	root = s
case "list": // one chain through small objects in random address order
	n := mb << 20 / 16
	// ... allocate n *link, then link them in the order of r.Perm(n)
	root = s[perm[0]] // only the head is a root, the slice dies
case "large": // few big pointerful objects
	n := mb << 20 / 2048 // 2 KiB structs of 256 pointers, each to a random large
```

Per-cycle CPU, ranges over 3 to 6 runs:

```text
shape  objects     GOMAXPROCS  Green Tea      nogreenteagc   change
graph   4,194,485  1           221-228 ms     494-543 ms     -55% to -58%
graph   4,194,596  14          322-358 ms     704-742 ms     -50% to -55%
list   16,777,395  1           2,106-2,279 ms 2,119-2,274 ms within 4%, no consistent winner
list   16,777,507  14          2,226-2,259 ms 2,267-2,400 ms -2% to -6%
large     131,253  1           260-278 ms     205-215 ms     +26% to +29%
large     131,368  14          358-372 ms     260-286 ms     +29% to +38%
```

### An allocation-driven loop

Forced cycles isolate the mark, but services pay GC through the pacer. The same
`churn` loop as the GOGC lesson (64-byte nodes, a 256 MB live set, 8 GiB allocated,
`GOGC=100`), with 4 allocating goroutines on `GOMAXPROCS=4` so no P is idle and
idle mark workers do not blur the GC CPU (`/cpu/classes/gc/total` minus idle):

```text
on   cycles 22  peak 840 MB  gc cpu 2.78s (assist 0.98s)  gc/busy 23%  wall 3.09s
off  cycles 22  peak 866 MB  gc cpu 5.38s (assist 2.58s)  gc/busy 34%  wall 4.16s
```

Over 6 runs: 21 to 23 cycles in both builds, GC CPU 2.75 to 2.86 s with Green Tea
against 5.38 to 5.78 s without (about 50% less), assists cut by more than half, and
the whole loop 20 to 26% faster.

### Where the gain does not appear

- **One long chain**: each node is discovered only after the previous one is
  scanned, so every span is dequeued with a single marked object. That is the case
  the blog calls potentially worse than the graph flood; the single-object fast
  path kept it even here. It is also serial: with 14 Ps the cycle still took about
  2.2 s of wall time, the same as its CPU time.
- **Objects above 512 bytes**: they are outside the span window, yet the Green Tea
  build spent 26 to 38% more CPU on them. A CPU profile of the `GOMAXPROCS=1` run
  shows why: `runtime.tryDeferToSpanScan` took 21.6% of samples in the Green Tea
  build. Every pointer first goes through that lookup, which returns false for a
  2 KiB target, and only then through the old `findObject` and `greyobject` path.
- **Against the 10 to 40% claim**: the graph and churn shapes beat 40%, but they are
  best cases (uniform 64-byte objects, random pointers that pile marks onto the same
  spans). The blog itself puts the modal improvement near 10%; a real heap mixes the
  three shapes above, so measure yours with the opt-out build before and after.

## Trade-offs

- **Heap shape decides the gain**: many small pointerful objects of one size class
  gain the most; deep chains gain nothing; large pointer arrays pay a small tax.
  Example: a `[]*Item` of 300-byte items benefits, a `map` of 2 KiB structs does not.
- **Vector acceleration is amd64 only**: the AVX-512 kernel needs Ice Lake or Zen 4
  and newer; arm64 servers (Graviton, Ampere) run the scalar span scan.
- **The opt-out is temporary**: `nogreenteagc` still builds in 1.27.0 despite the
  1.26 notes, but it is an experiment flag slated for removal. Use it to A/B and
  report an issue, not as a permanent configuration.
- **Forced-cycle benchmarks measure cost per cycle, not pacing**: Green Tea does not
  change how often the GC runs (21 to 23 cycles in both builds); it changes what each
  cycle costs. GOGC and GOMEMLIMIT stay the knobs for frequency.

## Documentation Links

- [The Green Tea Garbage Collector, The Go Blog (Knyszek and Clements, 2025)](https://go.dev/blog/greenteagc): doc
- [Go 1.26 Release Notes: new garbage collector, go.dev](https://go.dev/doc/go1.26): doc
- [Go 1.27 Release Notes, go.dev](https://go.dev/doc/go1.27): doc
- [runtime: green tea garbage collector, golang/go issue 73581](https://github.com/golang/go/issues/73581): doc
- [runtime/mgcmark_greenteagc.go at go1.27.0, Go source](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/runtime/mgcmark_greenteagc.go): doc
- [internal/buildcfg/exp.go at go1.27.0 (GOEXPERIMENT baseline), Go source](https://go.googlesource.com/go/+/refs/tags/go1.27.0/src/internal/buildcfg/exp.go): doc
- [A Guide to the Go Garbage Collector, go.dev](https://go.dev/doc/gc-guide): doc

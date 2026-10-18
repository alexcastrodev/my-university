---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

The .NET garbage collector is generational, compacting, and tunable, and most
applications never need to touch it. When one does (a service whose memory
keeps climbing in a container, latency spikes, a batch job doing thousands of
full collections), the questions are always the same: which generation is
being collected and why, what lands on the large object heap, which GC flavor
is running, and what limit it sees. This concept answers them with
measurements on .NET 10 and points to the settings and tools that matter.
Releasing non-memory resources is the topic of IDisposable, Finalizers and
Deterministic Cleanup.

## Use Cases

- Reading `dotnet-counters` during an incident and telling normal gen0
  activity from a gen2 storm.
- Finding why a service allocating 1 MB buffers spends its time in full GCs.
- Choosing workstation or server GC for a worker, a web API, or a small
  sidecar.
- Sizing a container memory limit and knowing what heap limit .NET derives
  from it.
- Deciding whether a `GC.Collect()` call in old code should stay.

## Deep Dive

### Generations and promotion

New small objects start in generation 0. A collection of a generation also
collects the younger ones, and every survivor moves up one generation, until
generation 2; a gen2 collection is a full collection.

```csharp
var o = new object();
GC.GetGeneration(o);   // 0
GC.Collect(0);         // o survives: generation 1
GC.Collect(1);         // generation 2
GC.Collect();          // stays in 2
```

A fresh live object that went through one full `GC.Collect()` reported
generation 1: promotion is one step per survived collection, not straight to
2. The point of generations is that most objects die young, so collecting
gen0 is cheap. The cost follows what survives, not what is allocated.
Allocating one million 1 KB arrays on workstation GC measured:

| Workload (1 GB allocated) | gen0 | gen1 | gen2 | Total pause |
|---|---|---|---|---|
| every array dies immediately | 125 | 0 | 0 | 3.1 to 3.7 ms |
| one array in ten kept in a list (100 MB live) | 128 | 34 | 4 | 20 to 27 ms |

Same allocation volume, several times the pause, because survivors must be
marked, copied, and promoted.

### The large object heap and the pinned object heap

Objects of 85,000 bytes or more go to the large object heap (LOH), which is
logically part of generation 2 and is collected only by gen2 collections. The
size includes the object header (24 bytes for a 64-bit `byte[]`), so the
boundary is not where you might guess:

```csharp
GC.GetGeneration(new byte[84_975]);    // 0
GC.GetGeneration(new byte[84_976]);    // 2: 84,976 + 24 = 85,000 bytes
GC.GetGeneration(new double[10_620]);  // 0
GC.GetGeneration(new double[10_622]);  // 2
```

The LOH is swept into a free list instead of compacted, to avoid copying
large blocks. You can request compaction with
`GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce`,
and the runtime compacts it automatically when a heap hard limit is set. The
expensive part is churn: allocating LOH objects consumes the LOH budget, and
exhausting it triggers a gen2 collection.

| 2,000 temporary 1 MB buffers | Time | Allocated | gen2 collections |
|---|---|---|---|
| `new byte[1 << 20]` (workstation) | 45 to 62 ms | 2,000 MB | 666 |
| `new byte[1 << 20]` (server, DATAS on or off) | 84 to 103 ms | 2,000 MB | 68 |
| `ArrayPool<byte>.Shared.Rent`/`Return` | 0 ms | 1 MB | 0 |

Pooling large buffers is the documented fix. A third physical heap, the pinned
object heap (POH), holds arrays allocated with
`GC.AllocateArray<T>(length, pinned: true)` (.NET 5 and later); they never
move, which suits buffers handed to native code for a long time.
`GC.GetGeneration` reported such an array as generation 2. Since .NET 7, on
64-bit Windows and Linux, the GC organizes memory in regions (4 MB for small
objects by default, eight times that for LOH and POH) instead of large
segments.

### Workstation, server, background, and DATAS

Workstation GC is the default for standalone apps; a host can change it, and
the Web SDK (`Microsoft.NET.Sdk.Web` in SDK 10.0.100) sets
`ServerGarbageCollection` to `true` unless the project says otherwise.

- **Workstation** collects on the thread that triggered the GC, with one heap.
  It is always used on a machine with a single logical CPU.
- **Server** creates one heap and one dedicated GC thread per logical CPU
  (`HeapCount=14` on this 14-core machine, read from
  `GC.GetConfigurationVariables()`). Its gen0 budget is much larger: the
  1 GB short-lived workload above ran 7 gen0 collections instead of 125.
  Many server-GC processes on one small machine compete for the same cores.
- **Background GC** is on by default in both flavors. It applies only to gen2:
  the full collection runs on dedicated threads while gen0 and gen1
  (foreground) collections still happen, pausing managed threads briefly.
- **DATAS** (dynamic adaptation to application sizes) was opt-in in .NET 8 and
  is enabled by default since .NET 9. It starts with one heap and grows or
  shrinks the heap count, aiming for a heap proportional to the live data
  instead of to the machine. The documentation reports a large working-set
  reduction for a 2 to 3 percent throughput cost on its benchmark;
  `<GarbageCollectionAdaptationMode>0</GarbageCollectionAdaptationMode>`
  turns it off.

### Containers and limits

Inside a container with a memory limit, the default heap hard limit is the
larger of 20 MB and 75 percent of that limit (`GCHeapHardLimitPercent`
changes the percentage, `GCHeapHardLimit` sets bytes). Running the sample with
`DOTNET_GCHeapHardLimit=0x10000000` made
`GC.GetGCMemoryInfo().TotalAvailableMemoryBytes` report 256 MB instead of the
machine's 36,864 MB. The limit covers only the GC heap, so the rest of the
container limit is what remains for thread stacks, JIT code, and native
memory. `GCConserveMemory`
(0 to 9) trades more frequent collections for a smaller heap, and
`GCHeapCount` caps server GC heaps.

### What changed in .NET 10

The .NET 10 runtime notes list one GC-specific change: on Arm64 the runtime
can now switch between write-barrier implementations as it already did on
x64, and the new Arm64 default tracks GC regions more precisely; Microsoft's
benchmarks show GC pause improvements from 8 percent to over 20 percent. The
GC configuration page also lists .NET 10 settings: `runtimeconfig.json` names
for `RegionRange` and `RegionSize`, and three knobs for the DATAS gen0 budget
(`DGen0GrowthPercent`, `DGen0GrowthMaxFactor`, `DGen0GrowthMinFactor`).
Separately, the JIT's wider escape analysis puts some small arrays and
delegates on the stack, so the GC never sees them; Value Types, Reference
Types and Boxing measures that.

### `GC.Collect` and measuring

`GC.Collect()` forces a full, blocking collection. Besides the pause, it
promotes everything still alive, so short-lived data becomes gen2 data that
only another full GC can free. The documentation reserves it for rare points
where a large amount of memory just became garbage, and offers
`GCCollectionMode.Optimized` to let the GC decline. To look before tuning:

```csharp
GC.CollectionCount(0);              // collections per generation
GC.GetTotalPauseDuration();         // .NET 7+
GC.GetTotalAllocatedBytes();
GC.GetGCMemoryInfo();               // heap size, fragmentation, per-generation sizes, pause %
```

For a running process, `dotnet-counters monitor` shows GC counts, heap size,
and allocation rate live, and `dotnet-gcdump collect` captures which types
hold the heap without a full memory dump. It does so by inducing a gen2
collection, which can pause a process with a large heap for a long time.

## Trade-offs

- **Workstation versus server GC.** Server GC gives higher throughput on a
  dedicated multi-core host but uses a GC thread per core and can grow the
  heap much larger; for many small containers or sidecars, workstation (or server
  with DATAS) keeps the footprint down.
- **DATAS on versus off.** DATAS keeps the heap close to the live data and
  frees memory when load drops, at a small throughput cost and with more gen0
  collections; a latency-critical service on a dedicated box may prefer it
  off.
  ```xml
  <GarbageCollectionAdaptationMode>0</GarbageCollectionAdaptationMode>
  ```
- **Allocating large buffers versus pooling.** `new byte[1 MB]` is simple and
  each one feeds the LOH budget toward a gen2 collection; `ArrayPool` removes
  that cost but requires returning every buffer and never using it afterwards.
- **Pinning.** The POH keeps native buffers from blocking compaction, but
  pinned memory can never be compacted; use it for long-lived buffers only,
  and `fixed` for short native calls.
- **`GC.Collect` versus trusting the GC.** A forced collection can make a
  memory graph look better in a demo and worse in production, by promoting
  live data and adding pauses. Measure with counters before keeping one.

## Lab

In this lab you get `Heap`, `Weak`, `Resurrector` and `Buffers` with methods that have no body. Each TODO asks you to run a small experiment against the real runtime, and your job is to return what it reports. You observe generations, promotion, the large object heap, weak references and pooling with real measurements instead of guesses. The tests never depend on exact heap sizes, and all of them live in a single class with parallelization turned off, so no other test can collect or allocate while one of them is measuring.

**The scenario**

Short experiments on the garbage collector.

- `Heap.cs`: `GenerationOfNewByteArray`, `GenerationsAfterCollections` and `CollectionsTriggeredBy` (plus two optional methods).
- `Tracking.cs`: `Weak.Of` and `Weak.IsAlive`, and the `Resurrector` class, with a finalizer and `Track`.
- `Buffers.cs`: `UseNewArray` (already done, allocates a new array per call) and `UsePooledArray`.

The weak reference tests create the garbage in a `NoInlining` method and then force a full collection, so the JIT cannot keep the object alive in the caller's frame.

**What you will do, step by step**

1. **Where an array is born (TODO-00).** `GenerationOfNewByteArray` allocates a `byte[length]` and returns its `GC.GetGeneration`. Objects of 85,000 bytes or more (header included) go to the large object heap, which is logically part of generation 2, so they report 2 right away.
2. **Promotion (TODO-01).** `GenerationsAfterCollections` returns the generation of the value measured after `GC.Collect(0)`, then after `GC.Collect(1)`, then after `GC.Collect(2)`, in that order. A survivor moves up one generation per collection of its generation, until generation 2.
3. **Force and measure a collection (TODO-02).** `CollectionsTriggeredBy` throws `ArgumentOutOfRangeException` when the generation is negative or greater than `GC.MaxGeneration`; otherwise it runs `GC.Collect(generation)` and returns how much `GC.CollectionCount(generation)` grew because of it.
4. **Weak reference (TODO-03).** `Weak.Of` returns a `WeakReference<T>` that does not keep the value alive, and `Weak.IsAlive` returns `true` while the target has not been collected (`TryGetTarget`).
5. **Resurrection (TODO-04).** In the `Resurrector` finalizer, store `this` in `Saved` (and do not throw: an error in a finalizer crashes the process). In `Track`, return two weak references: `Short` (does not track resurrection) and `Long` (`trackResurrection: true`). The short one is cleared before the finalizer, the long one survives.
6. **Pooling instead of the LOH (TODO-05).** `UsePooledArray` rents a buffer of at least `size` bytes from `ArrayPool<byte>.Shared`, passes it to `work` and returns the result, giving the buffer back to the pool in a `finally`, even when `work` throws. Remember the buffer may be longer than `size`.

**How you know you are done**

`dotnet test` (and then `dotnet test -c Release`) is all green. You should be able to explain why a 100,000 byte array is born in generation 2, what separates a short weak reference from a long one and why the pool allocates almost nothing while `UseNewArray` allocates a 1 MB array per call.

**Optional challenges**

- **TODO-06:** `RequestLohCompaction` asks for a one-time LOH compaction (`CompactOnce`), runs a blocking `GC.Collect()` and returns the mode read back afterwards, which resets itself to the default.
- **TODO-07:** `GenerationOfPinnedArray` allocates on the pinned object heap with `GC.AllocateArray<byte>(length, pinned: true)` and returns its generation (2).

**Prerequisites:** reference types and the managed heap, finalizers and `WeakReference`, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`, and then `dotnet test -c Release`. The methods throw `NotImplementedException` and each `TODO-NN` is a comment with the hint, so the red tests are your checklist.

## Documentation Links

- [Fundamentals of garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals) (doc)
- [Workstation vs. server garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/workstation-server-gc) (doc)
- [Background garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/background-gc) (doc)
- [Dynamic adaptation to application sizes (DATAS), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/datas) (doc)
- [Garbage collector config settings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector) (doc)
- [Large object heap, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/large-object-heap) (doc)
- [What's new in .NET 10 runtime: Arm64 write-barrier improvements, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime#arm64-write-barrier-improvements) (doc)
- [dotnet-counters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) (doc)

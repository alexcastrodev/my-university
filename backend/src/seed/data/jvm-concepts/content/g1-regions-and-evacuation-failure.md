---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand how G1 actually lays out and collects the heap — regions instead of fixed generations, humongous objects, and the concurrent mark cycle — well enough to read a GC log line by line and tell a real evacuation failure from a healthy young collection.

## Use Cases

- Explaining a p99 latency spike that has no matching slow query, no deploy, and no code path doing more work — because the request wasn't doing more work, it was stopped.
- Diagnosing a service that allocates megabyte-scale buffers (file parsing, large JSON payloads, batch imports) and finding out those buffers are quietly landing in the old generation.
- Telling `MaxGCPauseMillis` and `-XX:G1HeapRegionSize` apart from the decade of JDK 8-era G1 tuning advice that actively fights the adaptive model on JDK 17+.

## Deep Dive

### Regions instead of fixed generations

G1 divides the whole heap into equal-sized regions — a power of two chosen by ergonomics so there are roughly 2,048 of them, clamped between 1 MB and 32 MB. A 4 GB heap gets 2 MB regions. Generations still exist, but as a *label* on a region rather than a fixed place: at any moment a region is eden, survivor, old, humongous, or free, and its role changes over time. Because the generations aren't contiguous, G1 can collect an arbitrary subset of regions in one pause — the subset with the most garbage for the least work — instead of an entire space. That subset-picking is the whole "Garbage-First" idea.

```
-XX:G1HeapRegionSize=8m   # override the ergonomic default explicitly
```

### Humongous objects: the size-based cliff

An object at least half the size of a region is *humongous*. It skips eden entirely — G1 finds a run of contiguous free regions large enough to hold it and allocates it directly there, counted as old. On a 4 GB heap with 2 MB regions, that threshold is 1 MB: any single allocation of 1 MB or more (a byte array holding a parsed file chunk, a large `String`'s backing storage) lands in old on its first allocation, not after surviving several young collections.

Two consequences follow. Contiguity is required, so a heap with plenty of free regions scattered around can still fail to place a humongous object. And the unused tail of the last region is wasted — a 1.1 MB array in 2 MB regions burns 2 MB. G1 can eagerly reclaim a humongous region during an ordinary young collection when it can prove nothing references it (`-XX:+G1EagerReclaimHumongousObjects`, on by default), which helps enormously for short-lived large buffers — but it's a condition that has to hold, not a guarantee.

```java
// 1.5 MB is humongous on a 4GB/2MB-region heap, ordinary on an 8MB-region heap
byte[] chunk = new byte[1_500_000];
```

### Reading a G1 GC log line

Unified logging (`-Xlog:gc,gc+heap,gc+cpu=debug`) prints a triple of `before->after(capacity)` plus region counts per role for every collection:

```
GC(1841) Pause Young (Normal) (G1 Evacuation Pause) 2846M->1102M(4096M) 41.238ms
GC(1841) Eden regions: 872->0(844)
GC(1841) Survivor regions: 26->54(114)
GC(1841) Old regions: 388->401
GC(1841) Humongous regions: 96->84
GC(1841) User=0.14s Sys=0.01s Real=0.04s
```

The occupancy triple says this collection reclaimed 1.7 GB in 41 ms — copying live bytes is cheap, and dead objects cost nothing because nothing visits them. `Old regions: 388->401` is the number to watch: 13 regions (26 MB) got promoted in a single young collection. Multiply by collection frequency and that's the promotion rate driving how often the concurrent mark cycle has to run. `User=0.14s` against `Real=0.04s` means the parallel GC threads had roughly 3.5 cores available; when `Real` approaches `User`, the container's CPU limit — not the collector — is the bottleneck.

### Evacuation failure: to-space exhausted

A young collection copies survivors into fresh regions. If it runs out of free regions to copy into mid-pause, it can't abandon the collection halfway — it marks the remaining objects in place instead, at a much higher cost, and G1 falls back to a stop-the-world full compaction to recover:

```
GC(1903) To-space exhausted
GC(1903) Pause Young (Normal) (G1 Evacuation Pause) 3980M->3902M(4096M) 512.771ms
GC(1904) Pause Full (G1 Compaction Pause) 3902M->1421M(4096M) 3182.664ms
```

The failed pause reclaimed almost nothing (3,980M->3,902M) and cost 512 ms instead of the usual tens of milliseconds. The full GC that follows (parallel since JDK 10, JEP 307 — three seconds instead of the ten it used to take) did reclaim properly, down to 1,421M, which proves there was plenty of garbage. The collector wasn't short of garbage to reclaim, it was short of *contiguous free space* at the moment it needed somewhere to copy survivors — the classic signature is a humongous region count that stays flat across the failed collection, because those regions are occupied in old, permanently, until a concurrent cycle reclaims them.

### The concurrent mark cycle and IHOP

Young collections never reclaim old regions — the concurrent mark cycle does. It starts when old-generation occupancy crosses `InitiatingHeapOccupancyPercent` (default 45%), which G1 adjusts adaptively since JDK 9 based on observed allocation and marking rates rather than using the fixed default in practice. Marking runs concurrently with the application using snapshot-at-the-beginning (SATB): a write barrier records the *previous* value of every overwritten reference field, so the collector effectively marks against the object graph as it existed when the cycle began. That's conservative — it can retain objects that died mid-cycle — and it's the price of not stopping the world to trace a multi-gigabyte heap. The cycle produces knowledge (which old regions are mostly garbage), which mixed collections then act on by folding a handful of those regions into ordinary young collections until enough space is reclaimed.

## Trade-offs

- **`MaxGCPauseMillis` is a goal G1 fits young-generation size to, not a promise it enforces directly.** Lowering it shrinks eden so each pause has less to copy — it does not make collection itself faster. Push it too low and collections become more frequent, objects get visited earlier in their lives (more of them are still alive when the collector arrives), and a pause-length problem turns into a promotion problem.
  ```
  # smaller MaxGCPauseMillis -> smaller eden target in the next collection's Eden regions: X->0(Y) log line
  ```
- **A bigger heap gives the collector room to be lazy, which is why evacuation failures often disappear by adding headroom rather than tuning flags.** More heap means a larger eden, so objects have longer to die before anyone looks at them, and more free space available at the moment G1 needs somewhere to copy survivors.
- **Fixed young-generation size flags (`-XX:NewSize`, or pinning `G1NewSizePercent`/`G1MaxNewSizePercent` together) disable the pause-time model's main lever.** The entire point of G1 is resizing young generation to hit a pause goal; pinning it produces a worse Parallel GC, not a tuned G1.
- **Book vs today**: most G1 tuning advice still circulating online was written for JDK 8, when G1 was younger and its adaptive machinery weaker. On JDK 17+, hardcoding `ParallelGCThreads`/`ConcGCThreads` or `InitiatingHeapOccupancyPercent` without having measured the defaults are wrong for your workload fights machinery that has since gotten good at this — the defaults derive from available processors and observed allocation/marking rates for a reason.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 6 "Garbage Collection Algorithms", "The G1 GC" section, pp. 172-192 — book
- [HotSpot Virtual Machine Garbage Collection Tuning Guide — Java SE 25](https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector.html) — doc
- [JEP 307: Parallel Full GC for G1](https://openjdk.org/jeps/307) — doc
- [JDK-8199262: Adaptive IHOP](https://bugs.openjdk.org/browse/JDK-8199262) — doc

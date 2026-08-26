---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand the mechanism that lets ZGC keep pauses sub-millisecond regardless of heap size — colored pointers and the load barrier — what generational ZGC changed, and why "allocation stall" rather than a stop-the-world pause is the metric to watch when ZGC is the collector in use.

## Use Cases

- Deciding whether ZGC's sub-millisecond pauses are worth its throughput and footprint cost for a specific latency-critical service, instead of adopting it because the pause number looks good in isolation.
- Explaining why a service can look perfect on a GC pause dashboard under ZGC while requests are actually blocked — because the failure mode isn't a pause.
- Knowing which JDK version generational ZGC actually needs, since the pre-JDK-21 non-generational design has a real, different performance profile on allocation-heavy services.

## Deep Dive

### Colored pointers and the load barrier

The hard part of concurrent collection isn't marking, it's moving: if the collector relocates an object while application threads still hold references to its old address, those references are now wrong. G1 avoids this by doing all relocation inside a stop-the-world pause. ZGC can't, so a 64-bit reference stores collector metadata in its spare bits — whether the object has been marked in the current cycle, whether the pointer has been remapped since the last relocation. Every read of a reference field then passes through a **load barrier**: an inlined check of those bits that, in the common case, confirms the pointer is good and proceeds, and in the uncommon case fixes it on the spot, updating the reference in memory (self-healing) so the next read is fast.

```
G1:  write barrier on reference stores (maintains remembered sets) + stop-the-world relocation
ZGC: load barrier on reference reads (colored pointers) + concurrent relocation
```

G1 pays for relocation with pause time; ZGC pays for it with throughput spread thinly across every reference read the application performs. Neither collector does less work — they bill it differently, and ZGC bills it continuously rather than in a pause.

### Why the original ZGC wasn't generational

ZGC before JDK 21 collected the whole heap every cycle — no separate young generation. That means the weak generational hypothesis (most objects die young), which is what makes a G1 young collection cheap, bought ZGC nothing: every cycle traversed the whole live set, including long-lived data untouched in an hour, so cost per cycle was proportional to total live data rather than to recently-allocated data. For a service with a small live set that's fine; for a service allocating hard against a multi-gigabyte live set, it meant repeated full traversals just to reclaim short-lived request garbage G1 would have handled in a 40 ms young pause — pauses stayed tiny, exactly as advertised, but CPU cost and collection frequency both went up sharply.

### Generational ZGC's rollout

```
JDK 21  JEP 439  Generational ZGC ships, opt-in via -XX:+ZGenerational
JDK 23  JEP 474  Generational mode becomes the default
JDK 24  JEP 490  Non-generational mode removed entirely
```

Generational ZGC adds a young generation with the usual property that most collections only look at recently allocated objects, and needs store barriers in addition to load barriers to track references from old objects into young ones — the same cross-generation-reference problem G1 solves with remembered sets, solved differently. On JDK 21 or 22, ZGC without `-XX:+ZGenerational` is the old non-generational design; on JDK 23+, generational is what's actually running.

### Allocation stalls: the failure mode without a pause

Every collector fails somehow when allocation outruns collection. G1's is evacuation failure and a stop-the-world full compaction. ZGC has no stop-the-world fallback: when a thread wants memory that isn't available yet because the concurrent collector hasn't finished freeing it, that thread simply waits.

```
Allocation Stall (payment-worker-7) 42.118ms
Allocation Stall (http-nio-8080-exec-24) 39.882ms
GC(214) Major Collection (Allocation Rate) 3894M(95%)->1204M(29%)
```

The pause metric stays exactly as advertised — genuinely sub-millisecond — while requests are nonetheless blocked, stalled in allocation rather than stopped at a safepoint. A dashboard built around pause duration will show ZGC as perfect right up to the point the service is unusable; `jdk.ZAllocationStall` (a JFR event since JDK 15) is what actually has to be monitored.

### SoftMaxHeapSize

`-XX:SoftMaxHeapSize` tells ZGC to try to stay under a soft ceiling by collecting more eagerly, while leaving the hard `-Xmx` maximum available for genuine bursts:

```
-XX:+UseZGC
-XX:+ZGenerational
-XX:SoftMaxHeapSize=2g
-Xmx4g
```

It's a container-specific tool: it separates "the size I want steady-state" from "the size I may reach before failing," which a single `-Xmx` can't express. It's ZGC-only — G1 has no equivalent flag.

## Trade-offs

- **ZGC pause time doesn't scale with heap size or live set size — but that doesn't mean ZGC does less total work, only that the cost moved off the pause.** A service that's CPU-constrained can see *worse* throughput under ZGC even as its p99 improves, because concurrent GC threads are competing with request threads for the same cores.
- **Monitoring pause duration alone is actively misleading under ZGC.** The metric that reveals ZGC's actual failure mode is allocation stall count/duration, not pause count — a service can be failing while every pause-based dashboard reads green.
- **A memory percentage or heap-headroom setting tuned for G1's footprint doesn't carry over to ZGC.** ZGC keeps more metadata and wants more headroom to run its concurrent cycle comfortably; reusing a `-XX:MaxRAMPercentage` chosen for G1 can starve everything ZGC needs outside the heap, producing a container OOM-kill the JVM's own heap graph never shows as a problem.
- **Book vs today**: a 2020-era book describing ZGC as "experimental" and weighing it against G1 for allocation-heavy workloads is describing the pre-generational design. Generational ZGC (default since JDK 23, JEP 474) closed most of that specific gap — re-evaluate rather than trust a pre-JDK-21 verdict.

## Documentation Links

- [JEP 439: Generational ZGC](https://openjdk.org/jeps/439) — doc
- [JEP 474: ZGC: Generational Mode by Default](https://openjdk.org/jeps/474) — doc
- [JEP 490: ZGC: Remove the Non-Generational Mode](https://openjdk.org/jeps/490) — doc
- [The Z Garbage Collector — HotSpot GC Tuning Guide, Java SE 25](https://docs.oracle.com/en/java/javase/25/gctuning/z-garbage-collector.html) — doc

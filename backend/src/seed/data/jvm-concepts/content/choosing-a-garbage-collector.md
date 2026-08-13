---
version: 1.0
updatedAt: 2026-08-13
---
## Objective

Understand how the JVM's generational garbage collectors trade off pause time, throughput, and CPU overhead against each other, and which collector the JVM actually reaches for by default today versus what a 2020-era book assumes.

## Use Cases

- Diagnosing why a service has occasional multi-hundred-millisecond latency spikes and picking a collector that fixes it instead of just adding heap.
- Choosing GC flags for a CPU-constrained container (e.g. a single-vCPU pod) where a "better" collector can actually make things slower.
- Explaining GC trade-offs precisely in a performance/system-design interview instead of "G1 is the modern one."

## Deep Dive

### Generational collection: why splitting the heap works

Most objects die young — a loop variable, a request-scoped DTO, a `StringBuilder` used to assemble one response. The JVM exploits this "generational hypothesis" by splitting the heap into a small **young generation** (further split into eden and two survivor spaces) and a larger **old generation**. New objects are allocated in eden; a **minor GC** collects just the young generation, which is fast because most of what it scans is already garbage. Objects that survive several minor GCs get promoted to the old generation, which is collected far less often by a **major GC**.

Every collector also has to deal with heap fragmentation: freeing an object's memory isn't enough if the free space is scattered in small gaps too small for the next allocation, so collectors periodically **compact** the heap — relocating live objects to leave one contiguous free region. How aggressively and how often a collector compacts is most of what distinguishes the algorithms below.

### The lineup: what the JVM actually offers

```
Serial       — single-threaded, stop-the-world. Default on a 1-CPU machine/container.
Parallel     — multi-threaded stop-the-world, optimized for throughput (was "Throughput" collector).
G1           — regional heap, incremental/mostly-concurrent, aims for a target max pause time.
                Default collector on multi-CPU machines since JDK 9.
ZGC          — concurrent, region-based, sub-millisecond pauses regardless of heap size.
                Generational since JDK 21 (JEP 439) — young/old like the others, not the flat
                single-generation design it launched with.
Shenandoah   — concurrent, compacts while the application keeps running; low-pause like ZGC,
                different implementation approach (Red Hat/OpenJDK).
```

### Choosing under CPU pressure: the book's own numbers

Oaks benchmarks a single-CPU batch job (computing stock history for 100,000 stocks) under three collectors:

```
Serial:      434s elapsed, 79s paused for GC
Throughput:  503s elapsed, 144s paused for GC
G1:          501s elapsed, 97s paused for GC
```

The lesson isn't "Serial is best" — it's *why* G1 loses here: G1's background threads (concurrent marking, refinement) need spare CPU cycles to run alongside the application. On a single core, those threads compete directly with the actual work instead of running on genuinely idle cores, costing roughly 49 of G1's 501 seconds. The same G1 that wins decisively on a multi-core web server (better 99th-percentile latency by avoiding full GCs) can lose to the dead-simple Serial collector on a CPU-starved single-core batch job. The generalizable rule: **a "better" collector's background work has to come from somewhere** — on constrained hardware, that somewhere is your application's own CPU time.

## Trade-offs

- **G1's concurrent background threads need spare CPU, or they steal it from the application** — the exact mechanism behind the batch-job numbers above; a collector with more background work isn't free just because it doesn't stop the world as often.
- **Low-pause collectors (ZGC, Shenandoah) trade some throughput and memory overhead for consistently tiny pauses** — worth it for a latency-sensitive API where a single 500ms GC pause is a customer-visible spike, wasteful overhead for a batch job where only total elapsed time matters.
- **Book vs today**: this book (2nd ed., 2020, targeting JDK 8/11) frames G1 as "often the better choice" in JDK 11 and lists ZGC/Shenandoah under "Experimental GC Algorithms." Since then: **G1 has been the out-of-the-box default on multi-CPU machines since JDK 9** (not just "often the better choice" — it's what you get if you set nothing); **ZGC and Shenandoah are both long since production-grade**, not experimental, and **Generational ZGC (JEP 439, JDK 21)** closed most of the throughput gap ZGC used to have versus G1 by adopting the same young/old split every other collector already used; and the book's separate CMS (Concurrent Mark Sweep) chapter describes a collector that was **deprecated in JDK 9 and removed entirely in JDK 14** — don't reach for `-XX:+UseConcMarkSweepGC` on any current JDK, it doesn't exist.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 5 "An Introduction to Garbage Collection", pp. 121-152, and Chapter 6 "Garbage Collection Algorithms", pp. 153-201 — book
- [HotSpot Virtual Machine Garbage Collection Tuning Guide — Java SE 25](https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html) — doc
- [JEP 439: Generational ZGC](https://openjdk.org/jeps/439) — doc
- [Shenandoah GC — OpenJDK Wiki](https://wiki.openjdk.org/display/shenandoah/Main) — doc

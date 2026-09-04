---
version: 1.0
updatedAt: 2026-09-04
---
## Objective

Learn to size `-Xmx` as an economic decision grounded in what cloud and consumer hardware actually bundle per CPU core, measure real allocation rate and GC CPU cost instead of guessing, and avoid the extrapolation traps that make a naive cross-language or cross-benchmark memory comparison meaningless. This concept assumes the cost model from [Moving Garbage Collectors and the RAM/CPU Trade-off](/jvm-concepts/gc-ram-cpu-tradeoff) — that heap headroom is a direct lever on GC's CPU cost — and focuses on what that means in practice.

## Use Cases

- Responding to "why does this Java service use so much RAM" with a cost argument instead of shrinking `-Xmx` and hoping.
- Sizing `-Xmx` for a container from measured allocation rate and live set instead of a round number and iterating on `OutOfMemoryError`s.
- Explaining why a benchmark claiming "language X uses less RAM than Java" usually isn't measuring what it looks like it's measuring.
- Watching for the upcoming adaptive heap sizing flags instead of committing to hand-tuning `-Xmx` forever.

## Deep Dive

### RAM/CPU economics, from two extremes

Two thought experiments make the economics concrete instead of a vague sense that "RAM is cheap":

A program using 0% CPU needs 0 RAM — writing and reading memory always costs CPU cycles, so a program doing nothing allocates nothing. At the other extreme, consider two programs sharing a machine with 1 GB of RAM, both pegged at 100% CPU for the exact same wall-clock time: Program A uses 80 MB, Program B uses 800 MB.

```
1 GB budget, both programs at 100% CPU, identical wall-clock time:
  Program A:   80 MB used   →  cost: the whole 1 GB × time (idle RAM still unavailable to anyone else)
  Program B:  800 MB used   →  cost: the whole 1 GB × time (identical — you already paid for the GB)

  Now suppose Program B, still using 800 MB, finishes 5% sooner:
  → strictly more efficient — it captured the same 1 GB budget for less total time
```

They're equally efficient — the entire 1 GB was captured and unavailable to any other process for that whole run, whether the program touched 8% of it or 80%. There's no prize for using only 1% of RAM and 100% of CPU. And if the 800 MB program finishes even a little sooner, it's the *more* efficient one, despite using ten times the RAM to get there. RAM frugality only pays off when nothing else can use the freed RAM anyway during that window — which, on a CPU-saturated machine, is exactly the common case.

### What hardware actually bundles per core

The reason this matters in practice is that RAM and CPU are priced and delivered as a bundle, and the bundle skews toward "more RAM than you'd naively size a live set to":

```
laptops                         ~1.5–2.5 GB RAM per core
phones                          ~1–2 GB RAM per core
cloud, compute-optimized shapes  ≥1 GB RAM per core (even the smallest Kubernetes pods)
cloud, general-purpose shapes    ≥2 GB RAM per core
cloud, memory-optimized shapes   ≥4 GB RAM per core
genuinely tiny/edge devices      < 1 GB RAM per core (the real exception)
```

Cutting a program's RAM use in half rarely saves meaningful money on this hardware, because the bundled CPU core was the expensive part all along; trading a little of that already-bundled RAM for less CPU usually does save money, because CPU is what's actually scarce.

This reframes the standard "Java is bloated" benchmark. Picture a live set that a C++ program holds in exactly that much RAM while pegging 100% CPU — on a machine bundling 1 GB per core, that program uses roughly 1% of the RAM it paid for while using nearly all of the CPU. Compare a Java program on the same machine given 6× that live set as heap — a bar chart that *looks* wasteful next to C++'s footprint — and it's often still only around 5% of the RAM already bundled with that same CPU-bound purchase. Judged against what was actually bought, neither is wasteful; judged only against a live-set-sized baseline, only the second one looks bad — but that comparison was never a fair one to begin with.

### Don't extrapolate — benchmarks and applications are both snowflakes

A classic trap: someone matches a Java program's throughput and footprint in C++ using no more CPU, and the microbenchmark behind that claim turns out to allocate and free the *same fixed-size* object, on *one thread*, in a *tight, regular* loop. A free-list allocator reuses that exact-sized slot almost for free — the best possible case for it, and a genuinely misleading one to generalize from, since a real program allocates a messy mix of sizes, across threads, with irregular lifetimes that a free list handles far less gracefully.

The broader rule: the days when you could assign a fixed CPU cost to an operation are gone. How a subroutine compiles now depends on the surrounding program (JIT specialization, inlining decisions); how an allocator or collector behaves depends on the rest of the program too. Benchmarks and real applications are both "snowflakes" — a memory-management comparison that holds for one narrow, regular allocation pattern rarely extrapolates to a differently-shaped real application, in either direction, and rarely extrapolates across languages either.

### Measuring allocation rate and GC cost directly, instead of guessing

Three tools give real numbers instead of a hunch, from broadest to most precise:

- **JFR** (Java Flight Recorder) profiles allocations by call site — which line of code is actually generating the allocation rate, at sub-1% overhead, safe to run continuously in production.
- **`ThreadMXBean.getThreadAllocatedBytes(long[])`** (`com.sun.management`) returns bytes allocated per thread directly over JMX — useful for spotting which thread or pool is driving the allocation rate without attaching a profiler.
- **`MemoryMXBean.getTotalGcCpuTime()`** (`java.lang.management`, new in JDK 26) returns the JVM's own accumulated CPU time spent on GC, in nanoseconds — no more inferring GC's CPU share indirectly from allocation rate and pause logs. Pair it with `OperatingSystemMXBean.getProcessCpuTime()` to compute GC's share of total process CPU directly.

```java
com.sun.management.ThreadMXBean threadBean =
    (com.sun.management.ThreadMXBean) ManagementFactory.getThreadMXBean();
long[] allocatedBytes = threadBean.getThreadAllocatedBytes(
    new long[]{ Thread.currentThread().threadId() });

MemoryMXBean memoryBean = ManagementFactory.getMemoryMXBean();
long gcCpuNanos = memoryBean.getTotalGcCpuTime();   // -1 if unsupported/unavailable
```

Getting that GC CPU number right turned out to be its own small engineering project: naive measurement is noisy because of kernel timer update delays and millisecond-level precision limits on per-thread CPU sampling, which is exactly what the accounting work behind `getTotalGcCpuTime()` (and the `-Xlog:cpu` unified-logging option alongside it) was built to fix.

Once you know the real allocation rate and live set, size `-Xmx` from them rather than a guess, and lean toward heap sizes that match what you actually pay for (a 1 GB, 2 GB, or 4 GB machine/container shape) — that headroom is bundled with the CPU cores you're already paying for either way. Leaving `-Xmx` unset defaults to 25% of the machine's RAM, which is rarely the right number in either direction.

### What's coming: adaptive heap sizing (still a JEP draft)

JEP drafts for ZGC, G1, and Serial each propose having the collector adjust heap size automatically instead of a fixed `-Xmx`. For ZGC specifically ([JEP draft 8377305](https://openjdk.org/jeps/8377305)), the mechanism watches ZGC's actual CPU usage against a target and expands or contracts the heap to match: if actual CPU usage rises above target, the heap grows; if it drops below target, the heap shrinks. The target is a single tunable, `-XX:ZGCIntensity` (1–10, default 5) — higher values mean more frequent collections, higher CPU usage, and a smaller heap; lower values mean less frequent collections and a larger heap, enabled via `-XX:+ZAdaptiveHeapSizing`. That's the "prefer less CPU or prefer less RAM" knob this concept has been building toward, made explicit and automatic.

## Trade-offs

- **A benchmark comparing RAM use in isolation, without giving each side an equal share of what the machine actually bundles, isn't comparing what it looks like it's comparing.** Extrapolating from a synthetic, regular-allocation-pattern microbenchmark to a real, differently-shaped application — or from one language's memory-management strategy to another's — tends to be close to meaningless either way.
- **`-Xmx` left unset defaults to 25% of the machine's RAM, which is almost never the right number** for either a memory-hungry cache or a CPU-constrained single-core container — treat it as a required setting, not an optional tuning knob, and size it from measured allocation rate and live set.
- **Precisely measuring "CPU spent on GC" is itself a hard engineering problem**, not a given — kernel timer update delays and millisecond-level sampling precision make a naive measurement noisy. `MemoryMXBean.getTotalGcCpuTime()` exists specifically because deriving that number indirectly (from allocation rate and pause logs) wasn't trustworthy enough.
- **Adaptive heap sizing isn't shipped yet — it's a JEP draft**, so don't plan production configuration around exact flag names (`-XX:+ZAdaptiveHeapSizing`, `-XX:ZGCIntensity`) until it actually lands; today, sizing `-Xmx` by hand from measured allocation rate and live set remains the state of the art.

## Documentation Links

- [JDK Flight Recorder documentation — Java SE 25](https://docs.oracle.com/en/java/javase/25/jfapi/index.html) — doc
- [ThreadMXBean — Java SE 25 & JDK 25 (com.sun.management)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.management/com/sun/management/ThreadMXBean.html) — doc
- [MemoryMXBean — Java SE 26 & JDK 26 (getTotalGcCpuTime)](https://docs.oracle.com/en/java/javase/26/docs/api/java.management/java/lang/management/MemoryMXBean.html) — doc
- [JEP draft 8377305: Adaptive Heap Sizing for ZGC](https://openjdk.org/jeps/8377305) — doc

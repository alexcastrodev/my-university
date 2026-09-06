---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define speedup as T(1)/T(p) and efficiency as Speedup/p, and compute both from measured timings.
- Explain what "linear speedup" and "superlinear speedup" mean, and why superlinear speedup, though real, demands an honest explanation rather than being taken at face value.
- Distinguish speedup (a ratio of times) from raw wall-clock time, and explain why a "fast" parallel program can still have poor speedup.
- Recognize that speedup and efficiency are the two numbers every claim in the rest of this discipline's "Performance & Scalability" cluster gets measured against.

## Context & Motivation

The decomposition, communication, synchronization, granularity, and load-balancing concepts just covered are all, ultimately, in service of one practical goal: making a program run faster by using more processors. But "faster" needs a precise definition before it can be reasoned about mathematically — a parallel program that finishes in 10 seconds sounds fast, but whether that's a *good* result for the number of processors it used is a completely separate question. Speedup and efficiency are the two standard metrics LLNL's tutorial and UC Berkeley's CS267 both use to answer exactly that question, and they set up the vocabulary the next three concepts — Amdahl's Law, Gustafson's Law, and strong/weak scaling — all build on directly.

## Core Theory

### Speedup: how much faster, relative to sequential

**Speedup** on p processors is defined as:

```text
Speedup(p) = T(1) / T(p)
```

where T(1) is the time the best available sequential (single-processor) version of the program takes, and T(p) is the time the parallel version takes running on p processors. A speedup of 4 on 8 processors means the parallel version ran 4 times faster than the sequential one — using 8 processors to achieve that.

Two special cases are worth naming precisely:

- **Linear speedup**: Speedup(p) = p exactly — doubling the processors exactly halves the time. This is the theoretical ideal, rarely achieved in practice because of the communication, synchronization, and load-imbalance overheads already covered.
- **Superlinear speedup**: Speedup(p) > p — the parallel version is *more* than p times faster. This sounds impossible at first (how can splitting work among p processors do better than a perfect p-fold speedup?), but it is real and does happen, most commonly because each processor's smaller share of the data fits better into its local cache, reducing memory-hierarchy costs (already quantified in Computer Architecture's AMAT material) in a way the sequential version, working on the whole dataset at once, could not benefit from. Superlinear speedup is a genuine, explainable effect, not a measurement error — but any claim of it deserves exactly this kind of explanation, not just a number reported without context.

### Efficiency: speedup per processor

**Efficiency** normalizes speedup by the number of processors used:

```text
Efficiency(p) = Speedup(p) / p
```

Perfect linear speedup corresponds to an efficiency of 1.0 (100%) — every processor is contributing exactly its fair share. An efficiency of 0.5 means that, on average, each processor is only delivering half the benefit it theoretically could, due to overhead from communication, synchronization, or load imbalance. Efficiency is often the more honest number to report than speedup alone, because a large speedup number achieved with an enormous number of processors can still represent a poor return on the hardware actually used — recognizing this is exactly the same accounting discipline as efficiency versus raw output in any resource-constrained system.

### Why raw time alone is not enough

A parallel program that finishes in 2 seconds is not automatically "good" — if the sequential version also finished in 2.1 seconds, the speedup is barely above 1, meaning the parallelization effort bought almost nothing despite (presumably) using many processors. Speedup and efficiency force the comparison to always be relative to the best sequential baseline, which is the only way to honestly assess whether the parallelization effort — and the extra complexity of communication, synchronization, and decomposition it required — was actually worth it.

## Worked Examples

### Example 1: Computing speedup and efficiency from measured times

A sequential sorting program takes T(1) = 80 seconds. The same algorithm, parallelized, is measured on different processor counts:

```text
Processors (p)   T(p)      Speedup = T(1)/T(p)   Efficiency = Speedup/p
---------------  --------  ---------------------  -----------------------
1                 80s       1.0                     1.00 (100%)
2                 42s       1.90                    0.95 (95%)
4                 24s       3.33                    0.83 (83%)
8                 16s       5.00                    0.63 (63%)
16                12s       6.67                    0.42 (42%)
```

The pattern to notice: efficiency steadily declines as processors are added, even though speedup keeps increasing — a classic real-world signature of the communication and synchronization overheads discussed in the previous concepts, which grow relative to the (now smaller) per-processor share of the actual work. This declining-efficiency pattern is precisely what Amdahl's Law, covered next, gives a mathematical explanation for.

### Example 2: A superlinear speedup, explained honestly

A matrix computation has T(1) = 100 seconds on one processor, where the full matrix does not fit in that processor's cache, forcing many slow main-memory accesses. On 4 processors, each working on a quarter of the matrix that *does* fit entirely in its local cache, T(4) = 20 seconds.

```text
Speedup(4) = 100s / 20s = 5.0   (greater than 4 processors — superlinear)
Efficiency(4) = 5.0 / 4 = 1.25  (125% — greater than 100%)
```

This result is real and reproducible, not a measurement artifact — the explanation is that the sequential baseline was itself handicapped by cache misses the parallel version's smaller per-processor working set avoided entirely (a direct application of the memory-hierarchy and locality concepts from Computer Architecture). Reporting a superlinear speedup without this kind of explanation would be misleading; reporting it *with* the explanation is legitimate and instructive.

## Common Misconceptions & Pitfalls

- **"Superlinear speedup is impossible and must be a measurement error."** It is real and well-documented, almost always attributable to cache or memory-hierarchy effects that penalize the sequential baseline more than the parallel version — but it always deserves an explanation, not just a reported number.
- **"A faster wall-clock time always means good speedup."** Speedup and efficiency are always relative to the *best available sequential* baseline — a fast parallel time next to a poorly-optimized sequential baseline can produce a misleadingly large speedup number that says more about the weak baseline than about the parallelization.
- **"Efficiency above 1.0 (100%) is a sign of a calculation error."** It is unusual but legitimate (superlinear speedup, Example 2) — it should prompt investigation into *why*, not an assumption that the number itself is wrong.
- **"Speedup and efficiency are only useful for measuring finished programs."** They are equally useful as *predictive* tools before writing code — Amdahl's Law and Gustafson's Law, covered next, use exactly this speedup framework to predict achievable performance from a decomposition's structure alone, before any code is run.

## Summary

Speedup(p) = T(1)/T(p) measures how many times faster a parallel version is than the best sequential baseline on p processors; Efficiency(p) = Speedup(p)/p normalizes that by the processor count to measure how well each processor's share of the work is actually being used. Linear speedup (Speedup = p, Efficiency = 100%) is the ideal, rarely achieved because of communication, synchronization, and load-imbalance overhead; superlinear speedup (Speedup > p) is real but always traces back to a specific, explainable effect, most commonly cache locality. These two metrics are the precise vocabulary the next three concepts — Amdahl's Law, Gustafson's Law, and strong/weak scaling — use to explain and predict exactly how speedup behaves as processor count grows.

## Documentation Links

- [LLNL — Introduction to Parallel Computing Tutorial](https://hpc.llnl.gov/documentation/tutorials/introduction-parallel-computing-tutorial) — source for the speedup and efficiency performance concepts.
- [UC Berkeley CS267 — Applications of Parallel Computers](https://sites.google.com/lbl.gov/cs267-spr2024) — real course confirming speedup/efficiency as foundational performance metrics before introducing Amdahl's and Gustafson's laws.

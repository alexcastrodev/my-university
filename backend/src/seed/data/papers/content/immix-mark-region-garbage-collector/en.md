---
title: "Immix: A Mark-Region Garbage Collector with Space Efficiency, Fast Collection, and Mutator Performance"
summary: Immix is a garbage collector that marks live objects, reclaims memory in contiguous blocks and lines, and copies opportunistically to fight fragmentation, trying to avoid the usual trade-off between space, collection speed and program speed.
researchArea: Programming Languages
keywords: garbage collection, mark-region, immix, memory management, jvm, fragmentation
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Programs in managed languages such as Java allocate many small, short-lived objects, and the garbage collector decides how fast they run and how much memory they need. The paper starts from a classic trade-off among the three canonical tracing collectors. Semi-space copies live objects into a new space, which gives fast allocation and good cache locality but needs twice the memory. Mark-sweep never moves objects, which is space-efficient and quick to collect but scatters objects that were allocated together. Mark-compact slides objects together, which is compact but needs several passes over the heap and is slow to collect.

This PLDI 2008 paper by Blackburn and McKinley asks whether one design can get all three: space efficiency, fast collection and good mutator performance (the speed of the application itself). Their answer is Immix, built on a new family of collectors that they call mark-region.

Worth knowing first: the idea of tracing garbage collection (mark live objects, reclaim the rest), why locality matters for cache performance, and what fragmentation is.

## Contribution

- **The mark-region family.** A non-moving tracing collector that reclaims memory as contiguous regions ("sweep-to-region"), so that new objects can be allocated next to each other, the way a copying collector does, without a copy reserve.
- **Two granularities.** Immix manages 32 KB blocks and, inside partly used blocks, 128-byte lines. It prefers whole free blocks, and falls back to runs of free lines.
- **Opportunistic defragmentation.** When fragmentation is bad, the collector copies the objects of the most fragmented blocks while it is marking, in a single pass, and only when there is room to do so.
- **A detailed evaluation** of the design against the canonical collectors and a production generational collector.

## Methodology

Immix is implemented in MMTk inside Jikes RVM, a research Java virtual machine, and compared with semi-space, mark-sweep and mark-compact implementations in the same framework. The benchmarks are 20 programs from SPECjvm98, DaCapo (version 2006-10-MR2) and a fixed-workload pseudojbb2000. Results are reported as geometric means across heap sizes from 1 to 6 times the minimum heap that mark-sweep needs, on three machines (Intel Core 2 Duo, AMD Athlon and IBM PowerPC G5), with hardware performance counters on the Core 2 to explain locality.

The authors also use Immix as the mature space of a generational collector and compare it with Jikes RVM's production generational mark-sweep collector, and they run sensitivity tests on block and line size and ablations of the main features.

## Findings

These are the authors' reported results.

- A full-heap Immix outperforms the three canonical collectors at every heap size on all three architectures, typically by around 5 to 10%. The abstract states total-performance gains of 7 to 25% on average across the 20 benchmarks.
- Its mutator time and cache misses are close to those of semi-space, and its collection time is close to that of mark-sweep, which is the way it breaks the usual dichotomy.
- As the mature space of a generational collector, it matches or beats a highly tuned generational collector, for example about 5% better on jbb2000.
- The results are consistent: across 11 heap sizes and 20 benchmarks the worst case was a 4.9% slowdown (hsqldb at 1.1 times the minimum heap), and the best was a 74% improvement (jython against mark-sweep at the minimum heap).
- In the minimum heap needed to run a benchmark, Immix is on average at 86% of mark-sweep, which is 14% more space efficient and close to mark-compact (83%).
- The ablations show that each piece matters: with block marking alone, fragmentation would inflate the amount of memory marked by 93% on average, and some benchmarks cannot run at all in a 2 times heap without the full design. Overflow allocation helps three benchmarks and slows one (xalan).

## Critical Analysis

This is a careful empirical paper in a field where details matter. A few limits are worth noting.

- **One platform, one era of benchmarks.** All results come from Jikes RVM, 32-bit mode and Java benchmarks of 2006 to 2007, on a handful of cores. Behavior with large heaps, many cores, modern JIT compilers and different object lifetimes is outside the data.
- **Throughput is the metric.** The paper is about total time, collection time and mutator time. It makes little claim about pause times or tail latency, which matter for servers and real-time work.
- **Averages hide a spread.** The geometric means are favourable, but individual cases range from a 74% gain to a small slowdown, and fragmentation-heavy programs depend on the defragmentation engaging.
- **Simple heuristics.** Block and line sizes and the conditions that start copying are tuned by the authors, so the design carries parameters that a different workload might want to change.
- **The production comparison** is against one collector in one VM, and it is the authors' own VM-and-toolkit combination.

## Further Research

- Concurrent and incremental versions of Immix that bound pause times.
- Parallel, multi-core and large-heap behavior, and NUMA placement.
- Adaptive choices of block size, line size and defragmentation triggers from runtime feedback.
- Applying mark-region ideas to non-Java runtimes and to languages with different object layouts.

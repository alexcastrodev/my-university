---
title: "Roofline: An Insightful Visual Performance Model for Multicore Architectures"
summary: A one-graph performance model that bounds what a program can reach by either the peak floating-point rate or the memory bandwidth times the program's operational intensity, and uses stacked ceilings to say which optimizations to try first.
researchArea: High-Performance Computing
keywords: roofline, performance modeling, operational intensity, memory bandwidth, multicore, optimization
version: 1.0
updatedAt: 2026-11-01
---

## Overview

Around 2009 the move to multicore processors ended a long period in which most chips followed the same design. Some offered many simple cores, some fewer complex ones, some relied on multithreading and some replaced caches with explicitly managed local memory. That diversity makes the work of programmers, compiler writers and architects harder, because it is not obvious why a program is slow on one chip and what to change.

This article, by Samuel Williams, Andrew Waterman and David Patterson (Communications of the ACM, April 2009), proposes a deliberately simple model. They say that it need not be perfect, only insightful, and compare it to the "3Cs" model of cache misses, which also ignores details but has helped people for decades.

Worth knowing first: floating-point operations per second (Flops/s), DRAM bandwidth, what a cache miss is, and that a program can be limited either by computing or by moving data.

## Contribution

- **The Roofline.** One log-log graph per machine whose horizontal line is the peak floating-point performance and whose diagonal line is the peak memory bandwidth. A kernel can never be above the roof that sits over its operational intensity.
- **Operational intensity,** defined as operations per byte of traffic between the caches and DRAM. Because it counts DRAM traffic after the cache has filtered it, cache optimizations show up as a movement along the x-axis.
- **Ceilings.** Lower lines under the roof mark what you get without a given optimization (for example SIMD, instruction-level parallelism, software prefetching, memory affinity). Their order suggests the order in which to try optimizations, and the gap to the next ceiling is the possible reward.
- **A demonstration** on four multicore computers and four numerical kernels, and a list of misconceptions the authors had heard when presenting the work.

## Methodology

The bound is `attainable GFlops/s = min(peak floating-point performance, peak memory bandwidth x operational intensity)`. The roof and the ceilings are measured once per computer, not per kernel, with the specification sheet for the compute side and a series of progressively optimized microbenchmarks for sustainable DRAM bandwidth.

The four computers are all dual-socket: an Intel Xeon (Clovertown), an AMD Opteron X4 (Barcelona), a Sun UltraSPARC T2+ (Niagara 2) and an IBM Cell (QS20), chosen because their designs differ a lot. The four kernels come from the "Seven Dwarfs" of numerical methods: sparse matrix-vector multiply (SpMV), Lattice-Boltzmann magnetohydrodynamics (LBMHD), a 3D stencil and a 3D FFT. The kernels were optimized with autotuners from three earlier publications, and with FFTW for the FFT on three of the machines.

## Findings

These are the authors' reported results.

- On the Opteron X2 used as the running example, the roof is 17.6 GFlops/s and 15 GB/s. Its ceilings are 8.8 and 2.2 GFlops/s on the compute side, and 11, 4.8 and 2.7 GB/s on the memory side. The ridge point (the intensity needed to reach peak) moves from 1.0 Flops/byte on the X2 to 4.4 on the X4, which has roughly four times the peak with the same memory bandwidth.
- Ridge points are 6.7 Flops/byte for the Xeon and 4.4 for the X4, 0.33 for the T2+ and 0.65 for Cell. For the x86 machines that means 35 to 55 floating-point operations for every 8-byte operand that comes from DRAM.
- The operational intensities of the 16 kernel and computer combinations range from 0.25 to 1.64 Flops/byte, with a median of 0.60, far to the left of the x86 ridge points.
- In all 16 combinations the achieved performance falls between the model's upper and lower ceilings. For the Xeon and the X4, 15 of the 16 limiting ceilings are memory ceilings, while for the T2+ and Cell the limit is split about evenly.
- The ridge point predicted performance better than clock rate or peak rate. Cell reached the highest performance, but the T2+, with the lowest ridge point, was the easiest machine on which to get its best result.

## Critical Analysis

The model delivers what it promises: it is easy to draw, easy to read, and it explains a lot with two numbers per machine. The paper is also candid, with a section that answers misconceptions.

- **It is a bound, not a prediction.** The roof says what is impossible, not what is likely. A kernel far under the roof may be limited by something the graph does not show.
- **The evidence is authored by the people who tuned the kernels.** The optimized implementations come from the group's own earlier work, and the paper tells us that the bounds held, not that they could fail. A test where the model is wrong would be more informative.
- **The kernels are regular.** They have enough parallelism and are load balanced, which the authors state. Irregular, latency-bound or communication-bound programs are the cases where one wants a model most.
- **Hardware has moved.** The machines are from 2008 and 2009. In our reading, the idea has outlived them, since versions of the model are now widely used for GPUs and for cache levels, but the paper only mentions vector processors and GPUs as future work.
- **Operational intensity must be known.** The paper counts DRAM traffic with an analysis or counters (see its appendix), and the quality of the picture depends on that count being right.

## Further Research

- Using performance counters to set the height and the order of the ceilings for each kernel, which the authors list as a direction.
- Extending the model to other kernels and metrics, such as sort or ray tracing, to vector processors and to GPUs.
- Adding more resources to the graph (cache levels, network, energy) without losing the one-picture simplicity.
- Studies of whether the model changes what programmers do, for example with controlled user studies instead of the authors' own use.

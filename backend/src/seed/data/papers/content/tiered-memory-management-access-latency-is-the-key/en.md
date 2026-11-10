---
title: "Tiered Memory Management: Access Latency is the Key!"
summary: Colloid is a page placement mechanism for tiered memory that equalizes the measured loaded access latency of the tiers instead of packing the hottest pages in the default tier, reading hardware queue counters and applying Little's Law, and it plugs into HeMem, TPP and MEMTIS.
researchArea: Operating Systems
keywords: tiered memory, page placement, memory interconnect contention, cxl, access latency, little's law, numa
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Servers are gaining memory tiers: ordinary DDR-attached memory next to the memory of another socket, CXL-attached memory or High Bandwidth Memory, all cache-coherent and reached through plain load and store instructions. Deciding which pages live in which tier is the job of a tiering system. The systems this paper studies, HeMem, TPP and MEMTIS, innovate on access tracking, page migration and page size, yet they share one placement rule: pack as many of the hottest pages as possible in the default tier, meaning the tier with the lowest unloaded latency. The rule assumes the default tier stays faster than the alternate tiers even while it serves the hottest pages.

This SOSP 2024 paper (Austin), from Cornell University, argues that the assumption breaks as soon as many memory requests are in flight, a regime the authors call memory interconnect contention, and that latency inflation starts well before bandwidth saturates. Its answer is Colloid, a mechanism that places pages so that the average loaded latencies of the tiers are equal.

Four terms are worth keeping straight. Unloaded latency is what one lone request sees, loaded latency is what a request sees with many in flight. The default tier is the lowest unloaded latency tier and the alternate tiers are the rest. The CHA (Caching and Home Agent) is the per-slice unit of the processor that handles cache coherence and queues requests that miss the L3, which is where Colloid takes its measurements. The best-case placement is the authors' manually found optimum for a workload.

Worth knowing first: NUMA nodes and page tables, the fact that a core can keep only a bounded number of cache misses in flight, and Little's Law (average queue occupancy equals arrival rate times average time in the system). The paper does not cite the following two pairings, they are mine. [cache-ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) puts an eviction policy into the kernel's page cache, another case of memory policy that the kernel traditionally fixes. [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) rebuilds the mapping layer where a placement policy would act, and its authors list NUMA policy as not yet supported.

## Contribution

- **The principle of balancing access latencies.** Per-core throughput is N times 64 bytes divided by the average latency L, where N is the number of in-flight requests, bounded by line fill buffers. The average latency is p times LD plus (1 minus p) times LA, with p the share of accesses served by the default tier. If LD is below LA raise p, if it is above lower p, and LD equal to LA is the equilibrium. The authors argue that this captures unloaded latencies, tier bandwidth and contention below saturation, and that it generalizes to more than two tiers.
- **Latency measurement from hardware counters.** CHA counters give each tier's average queue occupancy O and request arrival rate R, and Little's Law gives L as O divided by R, at timescales as low as 1 microsecond. The authors smooth both signals with an EWMA and ignore the CPU to CHA leg (about 5 ns of the roughly 70 ns unloaded latency). Only reads are measured, since a store miss first reads the line.
- **The placement algorithm.** Every quantum it computes LD, LA and p, then promotes hot pages to the default tier if LD is lower and demotes them otherwise. A binary-search style rule keeps a low and a high watermark on p (starting at 0 and 1) and aims at their midpoint. If the watermarks collapse while latencies are still unequal, they are reset, which handles a shifted equilibrium. Thresholds epsilon and delta trade detection speed against stability, and a dynamic migration limit, the smaller of the desired rate shift and the system's own cap, avoids oscillation.
- **HeMem and MEMTIS.** For HeMem (520 lines, 10 ms quantum) the hot and cold lists become five frequency bins, so Colloid can pick pages whose access probabilities sum to the desired shift. For MEMTIS (411 lines, 500 ms quantum) it scans the per-tier hot lists and accounts for page size.
- **TPP.** In about 315 lines on Linux 6.3, a kernel module spin-polls the counters on a dedicated core. Access probability is estimated from time-to-fault, and the hint fault handler promotes or demotes a page only if its probability fits the desired shift. Hint faults are also enabled on default-tier pages so hot pages can be demoted.

## Methodology

The testbed is a dual-socket server with Intel Xeon Platinum 8362 CPUs (32 cores, 8 DDR4-3200 channels per socket) joined by UPI. Only one socket runs the application. The default tier is its local memory (32 GB, 70 ns unloaded) and the alternate tier is the other socket's memory (96 GB, 135 ns unloaded, a ratio of 1.9 that the authors say roughly matches CXL).

The main workload is GUPS from the HeMem paper: a 72 GB buffer with a random 24 GB hot set that receives 90% of accesses, 15 application threads, 64-byte objects with a 1:1 read/write ratio. A memory antagonist on 5, 10 or 15 other cores generates sequential read/write traffic to a buffer pinned in the default tier, giving contention intensities 1×, 2× and 3× (51%, 65% and 70% of bandwidth when run alone) beside 0×. The best case comes from manually placing 0 to 100% of the hot set in the default tier in steps of 10 with `mbind`.

Colloid runs with epsilon 0.01 and delta 0.05, on the three systems with their default parameters, and the authors also sweep the alternate tier's unloaded latency, object size and convergence under changing access patterns and changing contention. Three real applications run on 15 cores with the default tier set to one third of the working set: GAPBS PageRank on a Twitter graph, Silo with YCSB-C and CacheLib with the HeMemKV workload.

## Findings

These are the authors' reported results.

- **Existing systems fall short.** With 1× contention, HeMem, TPP and MEMTIS are 1.21×, 1.35× and 1.41× below the best case, and the gap grows to 2.3×, 2.36× and 2.46× at 3×. At 0× they are within 1.5%, 4.6% and 10.1% of it, MEMTIS losing most because it splits huge pages too early and cannot coalesce them.
- **The assumption fails.** Default-tier latency rises by 2.5×, 3.8× and 5× at 1×, 2× and 3×, which puts it 1.2×, 1.8× and 2.4× above the alternate tier. The best case sends only 25%, 4.5% and 4% of bandwidth to the default tier, while the three systems keep more than 90%, 75% and 85% there at every intensity.
- **Colloid closes most of the gap.** Throughput improves 1.2 to 2.3× for HeMem, 1.35 to 2.35× for TPP and 1.29 to 2.3× for MEMTIS, ending within 3%, 8% and 13% of the best case. At 0× it matches the unmodified systems. At 1× it splits the hot set across tiers, and at 2× and 3× it moves the whole hot set to the alternate tier, where default-tier latency still stays above the alternate tier's but the gap is much smaller.
- **Latency and object size.** At an alternate tier 2.7× slower than the default one, Colloid still gains 1.01 to 1.76× (HeMem), 1.03 to 1.76× (TPP) and 1.01 to 1.63× (MEMTIS), with smaller gains as the latency gap widens. With objects of 256 bytes or more it helps even at 0× (1.17 to 1.35×), because prefetching raises per-core parallelism and the default tier becomes slower than the alternate one (1.77× at 4096 bytes). Gains shrink a little as objects grow, since the alternate tier approaches saturation (53% of its bandwidth at 64 bytes, 96% at 4096).
- **Cost and convergence.** CPU overhead is under 2% for HeMem and MEMTIS and 4 to 6.5% for TPP, which uses an extra core. After a hot set change HeMem with Colloid takes about 3 seconds longer to converge. When contention jumps to 3× it reaches the best-case throughput in about 10 seconds, against about 25 s for MEMTIS and about 250 s for TPP, speeds that match each system's own reaction to access changes.
- **Real applications.** As contention grows, PageRank improves 1.05 to 1.92× (HeMem), 1.05 to 1.48× (TPP) and 1.12 to 2.12× (MEMTIS). Silo matches the baseline at low contention and improves 1.13 to 1.25×, 1.09 to 1.17× and 1.08 to 1.17× at higher contention. CacheLib at 2× and 3× improves 1.37 to 1.74×, 1.42 to 1.79× and 1.48 to 1.93×.

## Critical Analysis

The paper states its scope plainly. It concedes the following.

- **Scope of the design.** Colloid needs tiers that do not share memory channels and a way to read per-tier queue counters. The motivation studies contention on the default tier only, on the argument that contention on the alternate tier keeps the old assumption true. Reading latency also costs a dedicated core on TPP, and the existing systems' own CPU costs are left unstudied because no cores are oversubscribed.
- **Limits of the gains.** Gains fall as the alternate tier gets slower or its bandwidth fills, and Colloid does not speed up slow trackers, as TPP's hundreds of seconds to adapt show. It also adds about 3 seconds to HeMem's convergence. Raising unloaded latency by lowering the remote socket's uncore frequency also lowers its bandwidth, which the authors say makes their gains conservative.
- **Hardware-managed tiering.** Memory-mode and flat-mode caches make the same latency assumption, and integrating Colloid with them is left open.

The following points are a reading of the evidence, not claims of the paper.

- **Headline numbers and the body differ.** The abstract's 2.5× latency gap is not measured: the setup gives 2.4×, and 2.5× is derived from a 5× inflation and published CXL latencies. The abstract's "2.3× worse than optimal" is the HeMem figure, while TPP and MEMTIS reach 2.36× and 2.46× in the body. "Near-optimal" means 3%, 8% and 13%, and I use the body figures here.
- **Optimality is shown for one workload.** The best case comes from a manual sweep for GUPS only. The three applications report improvement over the baseline, not distance from an optimum, and gains such as Silo's 1.08 to 1.25× are modest.
- **The alternate tier is a NUMA node.** No real CXL device is used. The paper itself cites a study of real CXL hardware for saturation bandwidth that varies by up to 1.75× with the read/write mix, a behavior this setup does not probe.
- **Contention is synthetic and steady.** One sequential antagonist pinned to the default tier, held constant or switched once from 0× to 3×. Bursty or fluctuating co-tenants are not tested, and reaction times of 10 s for HeMem and about 250 s for TPP would matter there.
- **A narrow configuration space in the main text.** Capacity is fixed (the hot set fits the default tier in GUPS, one third of the working set elsewhere), and core counts, read/write ratios and parameter sensitivity are moved to an extended version that this note does not cover. The text states run-to-run spread only for Figure 1 (3 runs).
- **Alternatives are argued, not measured.** Carrefour (balancing request rates) and BATMAN (balancing by bandwidth ratio) are dismissed in text, and all three baselines share the placement rule under test. The two-tier-only evaluation leaves the multi-tier claim untested, and only Intel counters are implemented, though AMD counters are cited.

## Further Research

- Integrating the principle with hardware-managed tiering, so that data placement balances latency at cacheline granularity, which the authors name as interesting.
- Combining it with the other software tiering systems the authors list and with more than two tiers, where the paper only argues generalization.
- Testing on real CXL devices, on AMD processors and in virtual machines, where counter access is not discussed, with several tenants whose contention rises and falls.
- Comparing against an optimum for real applications, varying tier capacity ratios, and contention on both tiers at once.

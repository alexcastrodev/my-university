---
title: "Caladan: Mitigating Interference at Microsecond Timescales"
summary: Caladan manages cache, memory-bandwidth and hyperthread interference with core allocation alone, no cache partitioning. A scheduler core polls signals every 10 µs and a kernel module, KSCHED, moves cores in microseconds. Against its own reimplementation of Parties, memcached tail latency during GC drops from 580 ms to 52 µs.
researchArea: Operating Systems
keywords: interference, core allocation, performance isolation, memory bandwidth, hyperthreading, tail latency, colocation, KSCHED
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

The conventional wisdom is that CPU resources such as cores, caches, and memory bandwidth must be partitioned to achieve performance isolation between tasks. Both the widespread availability of cache partitioning in modern CPUs and the recommended practice of pinning latency-sensitive applications to dedicated cores attest to this belief. In this paper, we show that resource partitioning is neither necessary nor sufficient. Many applications experience bursty request patterns or phased behavior, drastically changing the amount and type of resources they need. Unfortunately, partitioning-based systems fail to react quickly enough to keep up with these changes, resulting in extreme spikes in latency and lost opportunities to increase CPU utilization. Caladan is a new CPU scheduler that can achieve significantly better quality of service (tail latency, throughput, etc.) through a collection of control signals and policies that rely on fast core allocation instead of resource partitioning. Caladan consists of a centralized scheduler core that actively manages resource contention in the memory hierarchy and between hyperthreads, and a kernel module that bypasses the standard Linux Kernel scheduler to support microsecond-scale monitoring and placement of tasks. When colocating memcached with a best-effort, garbage-collected workload, Caladan outperforms Parties, a state-of-the-art resource partitioning system, by 11,000x, reducing tail latency from 580 ms to 52 µs during shifts in resource usage while maintaining high CPU utilization.

## Overview

Operators pack latency-critical (LC) and best-effort (BE) tasks on one machine to raise utilization, and then the tasks fight over cores, the last-level cache (LLC), memory bandwidth and execution units. The usual answer is partitioning: Intel's Cache Allocation Technology (CAT) reserves LLC ways, and systems such as Heracles and Parties adjust cores and ways step by step. The authors measure their convergence at seconds (Table 1: Heracles decides every 2 to 15 s, Parties every 500 ms, converging in 10 to 20 s). Real load moves faster: a garbage collector in a BE task saturates memory bandwidth for 100 to 200 ms, halves memcached's service rate and drives its queueing delay up 5 µs every 10 µs, reaching a tail 1000x normal (Figure 1). From that arithmetic comes a rule: to keep latency from growing by X after the service rate halves, the scheduler must react within 2X.

This OSDI 2020 paper, from MIT CSAIL and UC Berkeley, is the direct successor of [Shenango](/papers/shenango-achieving-high-cpu-efficiency-for-latency-sensitive-datacenter-workloads) and shares its runtime (green threads, work stealing, kernel-bypass I/O, burstable and guaranteed cores). Shenango's only signal is queueing delay and it allocates only cores in response to load. Caladan keeps core allocation as its single lever but adds signals that point at the source of interference. It also cites [IX](/papers/ix-protected-dataplane-operating-system) and [Snap](/papers/snap-microkernel-approach-to-host-networking) among the systems that adjust cores for load, and [Shinjuku](/papers/shinjuku-preemptive-scheduling-for-usecond-scale-tail-latency) for IPI-based preemption.

Worth knowing first: hyperthread siblings share a physical core, so a busy sibling slows a request; memory access latency rises slowly with bandwidth and then exponentially near saturation; and the difference between service time (hurt by interference) and queueing delay (hurt by lost compute capacity).

## Contribution

- **Core allocation as the only lever.** Fewer cores for a task means less memory bandwidth, an idled sibling means no hyperthread contention, and extra cores for a victim recoup lost compute capacity. Table 2 maps each contended resource to an action. For the LLC no direct action exists, so Caladan only adds victim cores.
- **Three controllers on one dedicated scheduler core, each run every 10 µs.** The memory bandwidth controller reads the global DRAM bandwidth counter and, above THRESH_BW, samples per-core LLC misses through the PMU, finds the BE task with most misses and revokes one core per round. The hyperthread controller bans the sibling of a core whose LC request has run past THRESH_HT. The top-level allocator grants a core to any task whose queueing delay exceeds THRESH_QD, scoring cores by idle sibling pairs, then different-task pairings, then cache locality.
- **KSCHED, a 533-line kernel module.** The scheduler writes commands into per-core shared memory and kicks the target cores with multicast IPIs, so cores run the scheduling work themselves, asynchronously. It supports waking or preempting a task, idling a core with `mwait` and reading remote performance counters with a TSC timestamp.
- **Implementation.** The scheduler is 3,524 lines, derived from Shenango. The runtime links libibverbs and SPDK directly, so the scheduler core no longer forwards packets (a Shenango bottleneck). It measures packet queueing delay from NIC RX descriptor timestamps.
- **No partitioning hardware.** Caladan does not use CAT or Memory Bandwidth Allocation. The authors argue MBA leaves rate-limited cores stalling, and that CMT and MBM need milliseconds to stabilize.

## Methodology

One server with two 12-core Xeon Broadwell CPUs (24 hyperthreads each), a 40 Gb/s ConnectX-5 NIC and an Optane NVMe, Linux 5.2.0 with a modified multicast IPI path (5.4.0 for the Linux baseline, with BE tasks in SCHED_IDLE). Everything is confined to the first socket, TurboBoost, C-states and frequency scaling are off, and the Meltdown and MDS mitigations are disabled. Clients are quad-core machines with an open-loop Poisson load generator. 22 guaranteed LC cores leave one physical core for the scheduler. LC tasks: memcached (Facebook USR mix, modified to spawn a thread per connection), silo running TPC-C and a new NVMe block storage server with compression and encryption. BE tasks: PARSEC x264, swaptions (also a Boehm-GC version, swaptions-GC) and streamcluster, plus synthetic stream-L2 and stream-DRAM antagonists. Parties was not available, so the authors reimplemented it on the same runtime ("Parties*"), with hyperthreads enabled. THRESH_QD is 10 µs, THRESH_BW 25 GB/s (70 to 80% of capacity), THRESH_HT 25 µs for silo, 40 µs for storage and infinite for memcached.

## Findings

- **Constant bandwidth interference (stream-DRAM, Figure 4).** Linux and Shenango reach tail latencies up to 235x and 6x higher than without interference, and Shenango loses 75% of its throughput because its scheduler core, which also processes packets, is overloaded. Caladan and Parties* keep tail latency similar with and without interference.
- **Phased interference (memcached with swaptions-GC, 800,000 requests/s, 120 s run, Figure 5).** Parties* has 99.9th percentile latency 11,000x higher than Caladan during GC cycles and 5% less BE throughput. The 580 ms versus 52 µs figures are in the abstract. The time series itself is a log-scale chart, so intermediate values here would be a reading of the graph.
- **15 pairings (Figure 6).** Storage and memcached stay near their no-colocation tail latency. Silo shows a small increase at low load, attributed to LLC sensitivity. BE throughput depends on the pair: x264, swaptions-GC and stream-L2 trade CPU time linearly, while streamcluster and stream-DRAM are throttled by the bandwidth controller. The text gives no numbers for this figure.
- **Many tasks (Figure 7).** Three LC tasks plus swaptions-GC and streamcluster, up to 230,000 core reallocations per second, with low tail latency kept as load and GC change.
- **KSCHED.** Moving 22 tasks, Linux system calls cost 43x more scheduling work and 5x more latency. With 11 LC tasks Caladan reaches 560,000 reallocations/s at its peak, while the Linux-mechanism version bottlenecks near 285,000.
- **Controllers (Figure 8c, Figure 9).** Both are needed at higher storage load. Against Elfen's policies, Caladan gets 37% more LC throughput by letting the LC task co-run with itself, and 5% more BE throughput at low load. Without the hyperthread controller, tail latency is up to 117 µs higher.
- **Parameters (Figure 10).** THRESH_QD of 100 µs gives 7% more BE throughput for 54 µs higher LC tail latency.

## Critical Analysis

What the paper concedes: Caladan cannot manage interference across NUMA nodes and does not prevent transient-execution attacks between hyperthread siblings. It requires applications to use its runtime and LC tasks to expose concurrency (memcached was modified). Applications outside the runtime cannot be throttled. It sees LLC interference only through queueing delay, so it compensates by granting extra cores, and the authors suggest bringing hardware partitioning back for that case. Power management is not explored.

The following is my reading, not a claim of the paper.

- **Intel specifics.** The evaluation is on Broadwell Xeons, and the design leans on a global DRAM bandwidth counter, PMU LLC-miss counters, `mwait` and multicast IPIs. The paper does not discuss other vendors' CPUs, so portability is untested.
- **One machine.** The scheduler is per host. A cluster-level result is absent, and the paper only says a cluster scheduler could receive reports when provisioning prevents mitigation.
- **The headline baseline is a reimplementation.** The 11,000x is against Parties*, built by the authors without the original code and with kernel-bypass I/O and hyperthreads added, on one workload pair at one load. They also did not implement some Parties components (frequency scaling, resources not in contention). Heracles was not run, and its Table 1 numbers come from reported behavior.
- **Not compared.** No head-to-head with Shinjuku (only the reported IPI speeds), Arachne or ZygOS, and no cache-partitioned run of Caladan itself.
- **Tuning matters.** The authors tuned all three thresholds for low latency, and mitigations for Meltdown and MDS were disabled.

Later literature, marked as such and known here only from this catalog's analyses, not from the original papers: the [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) analysis notes that Caladan is absent as a baseline there, and the [Concord](/papers/concord-microsecond-scale-tail-latency-with-approximate-optimal-scheduling) analysis says Caladan is discussed but not run. I did not read other follow-up work.

## Further Research

- NUMA-aware mitigation (revoking cores or migrating tasks between nodes), which the authors plan.
- Hardware partitioning that tolerates fast-changing LLC use, which could cut the extra cores given to victims.
- Running tasks that do not use the custom runtime, since only Caladan-managed cores can be throttled.
- A comparison with in-kernel and delegated schedulers ([ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs)): can they react to interference at tens of microseconds without a spinning scheduler core? This question is mine, not the paper's.

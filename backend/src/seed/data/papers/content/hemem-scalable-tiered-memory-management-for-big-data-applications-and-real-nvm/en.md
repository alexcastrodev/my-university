---
title: "HeMem: Scalable Tiered Memory Management for Big Data Applications and Real NVM"
summary: HeMem is a user-space library that manages DRAM plus Intel Optane NVM, sampling memory accesses with PEBS instead of scanning page tables, sorting pages into hot and cold lists, and migrating them in the background by DMA or copy threads, measured on real Optane hardware against Optane memory mode, Linux Nimble and an emulated X-Mem.
researchArea: Operating Systems
keywords: tiered memory, nvm, intel optane, pebs, userfaultfd, page migration, hot and cold pages, dma
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

High-capacity non-volatile memory (NVM) is a new main memory tier. Tiered DRAM+NVM servers increase total memory capacity by up to 8x, but can diminish memory bandwidth by up to 7x and inflate latency by up to 63% if not managed well. The authors study existing hardware and software tiered memory management systems on the recently available Intel Optane DC NVM with big data applications and find that no existing system maximizes application performance on real NVM. They present HeMem, a tiered main memory management system designed from scratch for commercially available NVM. HeMem manages tiered memory asynchronously, batching and amortizing memory access tracking, migration and TLB synchronization overheads, and it monitors memory use by sampling accesses via CPU events rather than page tables. On Optane it outperforms hardware, OS and PL-based tiered memory management, with up to 50% runtime reduction for the GAP graph benchmark, 13% higher throughput for TPC-C on Silo, 16% lower tail latency under performance isolation for a key-value store, and up to 10x less NVM wear than the next best solution, without application modification.

## Overview

Optane DC NVM sits on the memory bus next to DRAM and offers up to 8x the capacity per module, at up to 7x lower bandwidth and up to twice the latency (Table 1: DRAM 82 ns and 107/80 GB/s read/write, Optane 175/94 ns and 32/11.2 GB/s). The problem is deciding which pages live in DRAM and which in NVM, and moving them at the lowest cost in CPU time, TLB shootdowns and memory bandwidth. This SOSP 2021 paper (University of Texas at Austin, with Wei Zhang at Microsoft) argues that the hardware answer (Optane memory mode, a direct-mapped DRAM cache with 64-byte blocks) is blind to hot and cold data and to read/write asymmetry, and that earlier OS and language-level proposals were evaluated only on emulated NVM.

Terms to keep straight: MM is Optane memory mode, a hardware mode and not a Linux feature. Nimble is a set of Linux extensions that exposes NVM as a NUMA node, scans and migrates pages sequentially (the evaluation gives it 4 migration threads). X-Mem is a language-based tiering runtime, which the authors only emulate by mapping large heap ranges to NVM. PEBS (processor event-based sampling) makes the CPU log sampled events, here with the target virtual address, into a buffer. userfaultfd forwards page faults to a user-space thread. GUPS is a random read-modify-write microbenchmark.

Worth knowing first: page tables and the accessed bit, TLB shootdowns, DAX files, and Linux NUMA migration. Six pairings follow, none cited by the paper and all mine. [ESX Server](/papers/memory-resource-management-in-vmware-esx-server) already estimated working sets by random sampling. [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) and [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) (same SOSP) also move policy out of the kernel, and [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) does it for the page cache. [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) redesigns the page-table layer HeMem avoids scanning, and the [Slab allocator](/papers/slab-allocator-object-caching-kernel-memory-allocator) serves the small kernel objects HeMem leaves in DRAM. [Caladan](/papers/caladan-mitigating-interference-at-microsecond-timescales) treats memory bandwidth and core allocation as interference, the same budget HeMem's background threads draw on.

## Contribution

- **A measurement study of real Optane.** Throughput by thread count and access size, and the cost of scanning page tables as memory grows, which yield the design principles.
- **Sampling instead of scanning.** PEBS counters give asynchronous access tracking at any granularity (the prototype uses huge pages), with separate read and write counts.
- **Asynchronous migration.** A policy thread moves pages by I/OAT DMA, or by copy threads when DMA is missing, while userfaultfd write protection keeps reads running during a move.
- **Policies built on data scalability and asymmetry.** Small allocations stay in DRAM, write-heavy pages get migration priority, and a per-application library allows per-application policy and a priority mode.
- **An evaluation on real hardware** against MM, Nimble and emulated X-Mem, plus NVM wear.

## Methodology

- **Design.** libHeMem (4,177 lines of C) is injected by LD_PRELOAD and intercepts mmap and madvise with libsyscall_intercept. Ranges under 1 GB go to the kernel, so small objects stay in DRAM. Larger ones are registered with userfaultfd and backed by DAX files for DRAM (reserved with memmap) and NVM. The kernel changes total 1,337 lines in userfaultfd, memory management and DAX handling, on Linux 5.1.0 with an unmerged write-protection patch.
- **Classification.** PEBS samples NVM loads, DRAM loads that miss the L3 and all stores. A page is hot at 8 sampled loads or 4 stores, and write-heavy past the store threshold. When any page reaches 18 samples, all counts are halved (cooling, done lazily with a clock). Pages sit in hot, cold and free FIFO lists per tier. The sample period is about 5,000 accesses.
- **Migration.** A policy thread runs every 10 ms, swaps cold DRAM pages for hot NVM ones, puts write-heavy pages first, keeps 1 GB of DRAM free, and caps migration at 10 GB/s. With DMA, batches of 4 over 2 channels worked best. Without it, 4 copy threads. If the hot set exceeds DRAM, nothing migrates.
- **Testbed.** One socket of a Cascade Lake-SP machine with 24 cores at 2.2 GHz, 192 GB of DRAM and 768 GB of Optane, pinned to one NUMA node. Workloads are GUPS, Silo with TPC-C, FlexKVS and GAP betweenness centrality (BC), with 3 GUPS runs averaged.

## Findings

- **Optane measurements.** Optane write bandwidth saturates at four threads. At scale DRAM random and sequential writes are 10.7x and 16.5x faster, DRAM random reads 2.7x faster, and sequential Optane reads beat DRAM random reads by 14%. The media granularity is 256 bytes, so small random accesses suffer. Scanning page tables with base pages takes on the order of seconds at terabyte scale (Figure 3, text only).
- **GUPS, uniform.** At a 128 GB working set HeMem gets 3.2x the GUPS of MM, and up to 3.7x with 24 threads. Nimble reaches at most 78% of either. With 24 threads and under 32 GB, HeMem is 10% below MM because its threads compete for cores.
- **GUPS, hot set and skew.** With a 512 GB working set HeMem is up to 2x better than MM as the hot set grows, and Nimble gets 25% of MM's GUPS. With a write-only 128 GB inside the hot set, MM and Nimble are 14% and 64% worse than HeMem.
- **Overheads.** PEBS tracking stays close to a manual optimum, and with migration it is within 5.9%. Page-table scanning costs 18% versus PEBS, and with scan and migration on one thread only 18% of the optimum (43% with a separate scan thread, which labels up to 300 GB of 512 GB as hot).
- **Silo (TPC-C).** If the data fits in DRAM (up to 864 warehouses), HeMem beats MM by up to 13% and Nimble by up to 82%. Past DRAM, MM wins by 17%. Running Silo wholly in NVM reaches 32% of HeMem. The intro says "400%" over X-Mem, which does not match.
- **Key-value store (FlexKVS).** At 700 GB (hot set 140 GB) throughput is 1.06 Mops/s for HeMem against 0.93 (MM), 0.92 (Nimble) and 0.90 (X-Mem). Latency in Table 3 is 20 against 35 µs at the median (HeMem and MM). With a priority instance in DRAM, HeMem's priority median is 86 against 127 µs and p99 is 239 against 278 (16% better), while the regular instance has p99.9 8% worse.
- **GAP and wear.** BC fits DRAM (2^28 vertices): HeMem beats MM by 93% on average. At 2^29 it beats MM by 58% and Nimble by 36% on average. NVM writes are 10x fewer than MM, and the page-table variant makes three orders of magnitude more early on.

## Critical Analysis

The paper is open about several limits.

- **Needs a hot set.** Uniform access over a working set larger than DRAM gains little, and when the hot set exceeds DRAM HeMem stops migrating. Silo past DRAM loses to MM.
- **Sampling is a trade-off.** At short sample periods up to 30% of samples are dropped, and thresholds above about 20 hurt. The thresholds were tuned on GUPS with one hot set size.
- **Scope.** Only user-space heap memory is tiered, not kernel objects, program text or the page cache. DRAM is reserved at boot, and NUMA effects are out of scope. The kernel patches, the Intel event names and the 1 GB cutoff tie it to one platform. Nimble crashed the TAS stack, so it has no latency result.

My reading, not the paper's claims.

- **The headline numbers disagree.** The abstract says 50% less runtime for GAP, the body gives 93% and 58% speedups over MM (93% faster is about 48% less time, my arithmetic). Latency percentages in the intro, body and Table 3 also differ.
- **Baselines.** X-Mem is emulated, and the paper does not quantify how far emulation misleads, citing other work for that claim. Spread is shown only in Figure 10.
- **Optane, later (not in the paper).** The [Register](https://www.theregister.com/2022/07/29/intel_optane_memory_dead/) reported in July 2022 that Intel was quitting Optane, with a $559 million inventory impairment in its Q2 report. The paper cannot show the policy generalizes to other media.
- **Later literature, seen only through this catalog's analyses, not the original papers.** [MEMTIS](/papers/memtis-efficient-memory-tiering-with-dynamic-page-classification) (2023) says HeMem's static thresholds mismanage the hot set and its sampling thread uses about 100% of a core. [Colloid](/papers/tiered-memory-management-access-latency-is-the-key) (2024) shows HeMem, TPP and MEMTIS share a hottest-in-the-default-tier rule that fails under bandwidth contention.

## Further Research

- A global HeMem daemon that coordinates per-process instances, and dynamic tiers shared with the kernel instead of boot-time DAX reservation, which the paper only sketches.
- Tiering for kernel objects and the page cache, which it leaves to separate mechanisms.
- Swapping as a third tier, and shared tiered memory across processes.
- Self-tuning thresholds and sample periods, and tests beyond a single socket and the Intel platform.

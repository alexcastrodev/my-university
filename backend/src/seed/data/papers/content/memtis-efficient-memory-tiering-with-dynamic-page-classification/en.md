---
title: "MEMTIS: Efficient Memory Tiering with Dynamic Page Classification and Page Size Determination"
summary: Memtis is a Linux tiered memory system that samples accesses with hardware counters, reads a histogram of page hotness to set hot, warm and cold thresholds that fit the fast tier, and splits only those huge pages whose subpages are accessed unevenly.
researchArea: Operating Systems
keywords: tiered memory, page placement, huge pages, page size, hotness classification, pebs, cxl
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Main memory is a large share of server cost, and the authors cite figures of about 37.1% of Meta's server costs and about 50% of Microsoft Azure's. Non-DRAM memory (NVM) and CXL-attached memory offer cheaper capacity at higher access latency, so a server can pair a small fast tier of local DRAM with a large capacity tier. Two decisions then decide performance: which pages live in which tier, and which page size to use, because huge pages cut address translation cost but waste fast tier space when only a few of their subpages are hot.

This SOSP 2023 paper (Koblenz), from Sungkyunkwan University, Virginia Tech and Igalia, argues that earlier systems get both decisions wrong: they decide hotness with heuristics and static thresholds, without looking at the overall distribution of page accesses, and they treat a huge page as hot or cold as a whole. Its answer is Memtis, a change to the Linux kernel that derives its thresholds from an access histogram and decides page size from measured skew. The ACM metadata writes the name MEMTIS and the paper writes Memtis, which is the form used below.

Terms to keep straight: the fast tier is local DRAM and the capacity tier is NVM or CXL memory. A huge page is 2 MB, made of 512 base-sized subpages of 4 KB. PEBS (Processor Event-Based Sampling) is an Intel feature that records the address of sampled events, such as last-level cache misses, in a buffer. rHR is the measured share of sampled accesses served by the fast tier, and eHR is the share Memtis estimates it would get with base pages only. ksampled and kmigrated are the two kernel threads that track accesses and migrate pages.

Worth knowing first: page tables, TLB reach and Transparent Huge Pages (THP) in Linux, and LRU-style page reclaim. Four pairings follow, and the connections between the papers are mine, not theirs. [Colloid](/papers/tiered-memory-management-access-latency-is-the-key) postdates this paper (SOSP 2024) and takes MEMTIS as one of its three base systems, questioning the placement rule Memtis shares with its peers. [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) redesigns the page table layer that a huge page split has to update. The paper cites Linux's multi-generational LRU (MGLRU) as proof that classification quality matters, and [cache-ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) ports MGLRU to eBPF for the file page cache. [PagedAttention](/papers/pagedattention-memory-management-for-llm-serving) faces a similar size trade-off for KV cache blocks, between hardware utilization and fragmentation.

## Contribution

- **Two findings about existing systems.** Hotness detection is suboptimal, so much of the fast tier holds pages that are not the hottest, and subpage accesses inside a huge page are often highly skewed. In the authors' example HeMem's static threshold fills spare fast tier space with arbitrary cold pages when the hot set is small and promotes an arbitrary subset when it is large, and for XSBench it classifies only 2 to 30 MB as hot. Silo touches only 5 to 15% of the subpages of a huge page. Systems that migrate in the page fault handler also add latency to the critical path.
- **Lightweight tracking.** ksampled samples retired LLC load misses and retired stores through PEBS, starting at intervals of 200 and 100,000 events, and tunes them from a moving average of its own CPU use to stay under 3% of one core, with 0.5% hysteresis. Hotness is an access count, multiplied by 512 for base pages so they compare fairly with huge pages. Two histograms of 16 exponential bins (128 bytes each) are kept: one at the real page size and one emulating base pages only.
- **Histogram-driven hot, warm and cold sets.** The hot threshold is raised as far as the hottest bins still fit the fast tier. Because bins are exponential, the hot set can fall short of capacity. If it is under 90% of the fast tier, a warm threshold one bin below it protects near-hot pages from demotion, and warm pages are never promoted or demoted unless free space is needed. New pages start at the hot threshold. Thresholds adapt every 100,000 samples and counts are halved ("cooling") every two million, which for exponential bins is a one-bin shift.
- **Background migration.** A kmigrated thread per tier wakes every 500 ms and moves pages between a promotion list and a demotion list. Demotion starts when free fast tier memory falls under 2% and takes cold pages first, then warm ones. Tracking, classification and migration never run in the fault path.
- **Skewness-aware splitting.** Memtis compares rHR with eHR and splits only when the gap is at least 5%, checked once the samples exceed a quarter of the allocated pages. The number of splits grows with the gap, the latency ratio of the tiers and the number of huge pages touched. Candidates are ranked by a skewness factor (the sum of squared subpage hotness divided by the squared count of hot subpages). Splitting frees never-written all-zero subpages and sends each subpage to its tier, and coalescing needs every constituent page to be hot, so it is rare.
- **Implementation.** 5,166 changed lines on Linux 5.15.19. Huge page metadata lives in unused struct pages of the compound page, and base page metadata in a 4 KB page pointed to from the page table page, for at most 0.195% memory overhead. The authors release the prototype.

## Methodology

The server is dual-socket with Intel Xeon Gold 5218R CPUs (20 cores at 2.1 GHz), each socket with 6 x 16 GB DDR4 and 6 x 128 GB Optane DCPMM, and only one socket is used to avoid NUMA effects. Two capacity tiers are tested: Optane NVM (300 ns load latency) and CXL memory emulated by a remote NUMA node with a slowed interconnect (177 ns, chosen because a cited study reports CXL adding 70 to 90 ns, and limited to directly attached CXL 1.1).

Eight applications run with 20 threads: Graph500, PageRank (GAP, Twitter graph), XSBench, Liblinear (KDD12), Silo (YCSB-C, Zipfian, 400 million pairs, 15 billion lookups), an in-memory Btree (157 million pairs, 8 billion lookups), and 603.bwaves and 654.roms from SPEC CPU 2017. The six baselines are AutoNUMA, AutoTiering, Tiering-0.8, TPP, Nimble and HeMem. Fast to capacity ratios are 1:2, 1:8 and 1:16 (the fast tier is 33% and 5.9% of resident set size in the first and last), reported relative to running entirely on NVM with THP. HeMem always places small allocations in the fast tier, so the authors shrink its configured size by that over-allocation (Table 3). Further studies cover scalability, a 2:1 configuration, a detailed HeMem comparison, parameter sensitivity and tracking overhead.

## Findings

These are the authors' reported results.

- **Overall on NVM.** Memtis is best in 23 of 24 cases, with a geometric mean 33.6% above the second-best system. TPP is second-best in 14 of 24 cases yet worst on PageRank at 1:2. Gains over the second-best are 16.3% to 17.7% on Graph500, 10.2% to 47.9% on PageRank, 17.3% to 43.7% on Liblinear (hit ratios 96.39% to 99.99%), 15.5% to 18.9% on Btree, 1.3% to 10.6% on 603.bwaves, 5.7% to 35.9% on 654.roms, and 15.9%, 21.2% and 7.1% on Silo at 1:2, 1:8 and 1:16.
- **Splitting.** In the 1:8 case the split gives 10.6% on Silo and 10.4% on Btree against Memtis without it, and Btree gains up to 19.9% at its best moment. Btree's resident set drops from 38.3 GB to 36.95, 27.2 and 20.9 GB at 1:2, 1:8 and 1:16, which works out to the 45.4% bloat reduction claimed in the introduction. The gap between eHR and the hit ratio without splitting is 64.1% on Silo and 36.42% on Btree, and splitting raises the hit ratio by 52.91% and 19.92%.
- **Warm set.** It removes 2.7% to 64.8% of migration traffic but hurts 603.bwaves, where a large warm set delays freeing space for short-lived allocations. Nimble migrates 56.43 times more than Memtis on Silo.
- **Versus HeMem.** On Btree, histogram classification alone is 1.4% below HeMem+ (HeMem given the same configured fast tier size as Memtis, so it uses more fast tier memory), and adding splitting makes Memtis 22.6% faster than HeMem+. HeMem's sampling thread uses about 100% of a core. HeMem could not run several 1:8 and 1:16 cases.
- **Scale.** Growing Graph500 from 128 GB to 690 GB with a 64 GB fast tier keeps Memtis ahead by 8.1% to 60.5%, with HeMem second-best at 336 GB and 690 GB.
- **2:1 and CXL.** At 2:1, Meta's production target, Memtis is close to all-DRAM except on SPEC and beats TPP by 6.1% to 33.3% when the sampled pages exceed the fast tier. On emulated CXL it beats TPP on all eight benchmarks, by up to 102.9% on PageRank, with smaller gaps as latencies converge.
- **Overhead and sensitivity.** ksampled averages 2.016% of one CPU (3.0% at most) and costs 0.922% of performance on average, 2.384% at most. Results are insensitive to adaptation and cooling intervals from one tenth to ten times the default, except a 1M adaptation interval.

## Critical Analysis

The paper is open about where hardware sampling and its own policies fall short. It concedes the following.

- **A PEBS blind spot.** Rarely or never accessed pages are unlikely to be sampled, so their hotness is inaccurate. The authors suggest adding page table scanning, as TMTS does, while noting it may add overhead without a gain. On 2:1 they also grant sampling limits, and SPEC does not reach all-DRAM.
- **Policies that lose.** The warm set hurts 603.bwaves, splitting does not raise its hit ratio, and the 10x adaptation interval hurts small applications.
- **Scope.** One socket, emulated CXL (the paper footnotes that no CXL hardware was publicly available), no CXL switches, and a TMTS comparison in discussion only, with different goals.

The following points are a reading of the evidence, not claims of the paper.

- **The headline numbers disagree.** The abstract says Memtis beats "their best by up to 33.6%", but the introduction and Section 6 give 33.6% as a geometric mean. The abstract's 169.0% appears nowhere in the body text, so it is probably read off a chart, and I use the body figures.
- **No spread is reported.** The text gives no repetition counts or error bars, and several differences are small (7.1% on Silo at 1:16, 1.3% on 603.bwaves, the 1.4% gap to HeMem+). The second-best system changes per case, so the geometric mean compares against a moving target.
- **The HeMem comparison needs care.** Main runs keep all 20 cores busy, which penalizes HeMem's sampling thread, and the 16-thread follow-up covers only 1:2. HeMem also lacks results in several cases and was resized by hand.
- **The split trigger is hit ratio, not translation cost.** The paper says Memtis balances access cost and address translation cost, but eHR minus rHR and the tier latency ratio drive the decision. No TLB miss counts are reported, and the cost of a split appears only as a "small performance dip" in one time series.
- **Constants are fixed by hand.** The 0.9, 0.4, 5%, 2% and 500 ms are fixed choices (the paper calls only 0.9 empirical), and sensitivity is reported only for the adaptation and cooling intervals. Algorithm 1 is printed with an "or" in its loop condition, where the prose implies "and".
- **Contention and tenancy are untested.** The text describes no co-running applications and no bandwidth antagonist, the premise [Colloid](/papers/tiered-memory-management-access-latency-is-the-key) later challenges. Only Intel PEBS is evaluated, and MGLRU is cited but not compared.

## Further Research

- Combining PEBS with page table scanning so that rarely accessed pages are classified well, which the authors name as a possible fix.
- Real CXL hardware, CXL switches and multi-socket machines, which the paper leaves out or emulates with one latency setting.
- Several tenants sharing a fast tier, memory bandwidth contention and AMD IBS, none of which the paper tests.
- A split trigger that includes measured TLB cost, with the price of a split quantified, and tuning of its constants.

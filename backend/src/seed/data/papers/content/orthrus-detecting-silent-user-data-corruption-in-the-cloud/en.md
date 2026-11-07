---
title: "Orthrus: Efficient and Timely Detection of Silent User Data Corruption in the Cloud with Resource-Adaptive Computation Validation"
summary: Orthrus re-executes annotated data-path operators on a different core against versioned memory, validates only as many as the spare cores allow, and checks data that crosses the control path with checksums, so it catches most silent CPU-induced corruption of user data for a few percent of overhead.
researchArea: Distributed Systems
keywords: silent data corruption, mercurial cores, computation validation, versioned memory, adaptive sampling, replication-based validation, fault injection
version: 1.0
updatedAt: 2026-11-07
---

## Overview

At cloud scale, processors are no longer fully trustworthy. Studies from Google (who call such cores "mercurial"), Meta and Alibaba describe cores that start computing wrongly after installation, often one core at a time, without crashing anything or raising a hardware warning. The paper cites an Alibaba test of more than one million processors in which 3.61 in every 10,000 showed errors capable of causing silent data corruption (SDC). An SDC that changes what a database returns can violate an SLA, which the authors argue is far worse than a crash.

This SOSP 2025 paper (held in Seoul), from the University of Chinese Academy of Sciences, UCLA, UC Berkeley, Tsinghua University and Peking University, asks how to catch such corruption online and cheaply enough for production. Periodic offline CPU testing, for example every three months, finds bad cores but not the data they already corrupted. The authors say replication-based validation (RBV), which runs a full replica, needs more than 100% extra CPU and memory, and instruction-level validation (ILV) needs special hardware and slows execution 50-fold.

Terms to keep straight: the control path (network, parsing, dispatch) moves user data without changing it, while the data path holds operators such as get, set, map and reduce. A closure is an annotated data-path operator, APP is its original execution and VAL is its re-execution on another core. Coverage is the share of injected corruptions that get detected, and a masked error is one that never changes a result.

Worth knowing first: the replicated-state-machine idea behind RBV, which the paper's related work grounds in [Paxos](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm) and illustrates with replicated databases such as [Spanner](/papers/spanner-globally-distributed-database). The paper cites all three, but it only borrows the replication pattern, not their protocols. LLVM IR and escape analysis help for the compiler part.

## Contribution

- **A split that makes validation cheap.** In Memcached the control path is over 20× larger than the data path, and only four files (assoc.c, hash.c, item.c, cache.c) manipulate user data. Orthrus re-executes only data-path operators instead of the whole program, as RBV does.
- **Two annotations and a compiler.** Developers mark operators with `closure` and data structures with `user-data`. An LLVM pass finds each closure's inputs and outputs, places user-data allocations in versioned memory (`OrthrusNew`) and routes accesses through `OrthrusPtr`, using type inference and escape analysis. Closures must be single-threaded, and objects that do not escape stay in a private heap.
- **Versioned memory and closure logs.** The application and the validator are separate processes with private heaps and a shared user-data space. Every `store` creates a new version out of place, so the validator can re-run a closure on exactly the memory state the application saw. A closure log records inputs, outputs, written versions and system call results, which are replayed rather than re-executed. The validator writes only to its own heap and compares outputs with an overloadable `==` or bit by bit.
- **Out-of-order validation on spare cores.** Logs go to per-core queues, and the validator runs on Shenango user threads, on idle cores of the same NUMA node but never on the application's core, because Intel ALUs, FPUs and vector units are core-private. If a closure's recent validation latency (last eight logs) exceeds a threshold such as 50% above the average, the scheduler starts another validation thread that takes half of its queues, and work stealing balances the load.
- **Resource-adaptive sampling.** Validation starts with every closure at low priority and lowers the sampling rate in steps when delay passes a threshold. Priority goes to closures not validated recently, tracked per (closure, caller) pair, and to closures the compiler tags as using floating-point or vector instructions, since earlier studies tie errors to such instructions and to specific code.
- **Checksums for the control path.** Each data version carries a 16-bit CRC, created at `OrthrusNew` or `store` and checked at the first `load` after the data crosses the control path. The authors say it costs a few dozen CPU cycles per object.
- **Version reclamation without reference counts.** A version is visible from its creation until the next version or a delete, and a closure is active from execution until validation ends. Versions whose window closed before the earliest pending closure started are freed in batches, an approximation that avoids the atomic operations of reference counting.
- **Safe mode.** By default results are returned without waiting for validation. An optional strict mode withholds results until their closure is validated.

## Methodology

Orthrus is written in C/C++ on LLVM. Experiments run on three servers, each with two Intel Xeon Gold 6342 CPUs and 100 Gbps ConnectX-5 InfiniBand, with Turbo Boost, C-states and frequency scaling disabled. Four applications were annotated: Memcached (five closures, a skewed CacheLib trace of 150 million operations, 32 client threads against 4 server threads), Masstree (200 million operations of the ALEX workload, half range queries and half updates, 4 server cores and 16 client cores), the in-memory tier of an LSM-tree (50 million random writes, an intentional stress test) and Phoenix (word count over 15 GB of WMT data, 16 cores). The authors say porting these applications changed fewer than 20 lines.

The baselines are the unmodified applications (vanilla) and RBV, which the authors set up as a replica on a separate server with as many cores as the application, fed batched requests in the same order and interrupting the primary on any mismatch. ILV is excluded for its hardware needs and overhead. Orthrus used two validation cores for the overhead and latency experiments and varied them for coverage.

Coverage was measured by compiler-based fault injection (a machine-level LLVM pass built on REFINE) with bit flips, stuck-at-0, stuck-at-1 and no-op faults, in both control and data paths, over the four vulnerable feature types Alibaba reported: arithmetic logic, vector, floating point and cache coherence. Coverage is detected corruptions divided by corruptions that occurred, compared with RBV and with random sampling. A second experiment fixed two cores and allowed 5% to 40% extra memory above the vanilla footprint.

## Findings

These are the authors' reported results.

- **Overhead.** With two validation cores, Orthrus costs 4% execution time and 25% memory on average, against overheads of 2.0× and 2.1× for RBV. The introduction summarizes this as 1.9× faster than RBV.
- **Per application.** Memcached loses 4.4% of throughput against vanilla and is 1.6× faster than RBV, which spends 43% of its CPU on communication. Masstree stays comparable to vanilla while RBV is 65% lower than Orthrus, a 2.9× difference. LSMTree keeps 95% of vanilla throughput at 34% extra memory, and RBV trails it by 54%. Phoenix adds under 2% time and 2.6% memory, while RBV loses 51% of throughput and reports a 2.1× memory overhead.
- **Data management costs.** `OrthrusPtr` adds 7% memory and 3% runtime on average, and checksums cost under 1%. With one validation core, memory use drops by an average of 36%, because logs are validated or skipped sooner.
- **Timeliness.** Average validation latency is 1.6 µs for Memcached, 22.6 µs for Masstree, 7.7 µs for LSMTree and 234 ms for Phoenix, whose operations take up to 240 ms. RBV averages 90 µs for Memcached (56× higher) and 513 ms for Phoenix, and is 21× worse for Masstree and 8× for LSMTree. Memcached-RBV also shows 95th-percentile request latency up to 1000× that of Orthrus.
- **Coverage with abundant cores.** With as many validation cores as application cores, Orthrus detects 97.2%, 97.6%, 97.6% and 98.9% of injected arithmetic, floating-point, vector and cache SDCs, against 98.3%, 99.5%, 99.5% and 99.8% for RBV. All but three of the cases RBV caught and Orthrus missed were control-path errors, and the three were system call errors (one in a write, two in mutex operations).
- **Coverage with few cores.** The abstract reports 87%, 91% and 96% with one, two and four validation cores. The text gives 86.7% on average at one core, which is 1.41× random sampling. Memcached is unchanged, Phoenix is lowest at 78.2% (16 threads, memory-heavy comparison) and Masstree loses only 8.6% going from four cores to one.
- **Memory limits.** With two cores and extra memory capped, Phoenix stays stable, Masstree's detection falls steadily as memory shrinks (tree updates and unvalidated closures delay reclamation), and Memcached is affected only modestly.

## Critical Analysis

The paper is open about being a best-effort tool, not a guarantee, and concedes the following.

- **Blind spots by design.** Masked errors are invisible, which the authors accept since they do not change results. System calls, locks and other non-deterministic calls are replayed from the log, not validated, though the authors find only 0.04% of executed instructions in them. An error that makes the control path call the wrong operator escapes the checksums, two cores failing identically would go unnoticed, and corruption of non-escaping temporary objects is missed unless it reaches versioned memory.
- **Sampling can skip errors.** Coverage depends on the cores left over, and functions not selected for validation are not checked. The authors point to RBV when resources are abundant and to offline testing if the goal is only to find faulty CPUs.
- **Costs left open.** The authors name a dedicated pool allocator for version metadata and coarser annotations as future work to reduce the 7% and 3% costs, and call the all-writes LSMTree workload unrealistic.

The following points are a reading of the evidence, not claims of the paper.

- **The faults are emulated, and details are thin.** Compiler-injected bit flips, stuck-at and no-op faults stand in for real defective cores, which the appendix says are not available on the market. Table 2 is described in the text as injected errors but its column is titled "Total SDCs" (about 2,500 cases by my sum), so it is unclear whether masked and fail-stop outcomes were filtered first. No repetitions or seeds are reported, and the text I read does not say how a fault planted in a closure stays out of the validator's re-execution of the same code. The paper defers injection details to a supplementary document.
- **Headline numbers differ across sections.** The abstract says overhead is 2% to 6%, the body says about 4%. Memory overhead is about 20% in the reclamation section, 25% in the evaluation, and up to 35% for Masstree. The text gives 97.2% for Orthrus on arithmetic faults, but the Table 2 counts sum to 96.5%. The Phoenix memory-limit text reports an average of 91% and then a "slight decrease" to 92.7%, which reads as a typo.
- **The latency claim is stronger than the data.** The introduction cites 40 µs and "three orders of magnitude" lower than RBV, and §4.3 says "two or three orders". The averages the text gives are 56×, 21× and 8× for the three latency-critical applications and about 2× for Phoenix (513 ms against 234 ms). Only the Memcached tail request latency, a different metric, reaches 1000×.
- **Detection is after the fact by default.** The goals section says the application is aborted once an SDC is found so corrupted data is not returned, yet by default results are returned without waiting for validation. Strict safe mode closes the gap, but it is never measured, only argued from small validation costs, and Phoenix reveals results only at the end with a 234 ms average validation latency. Closures dropped by sampling never get a latency at all.
- **The RBV baseline and the workloads are narrow.** RBV is the authors' own setup, and they attribute its losses to serialization, replaying order and comparing complex structures, so how much a differently built replica would narrow the gap is untested. All four applications are key-value or batch workloads with few closures, Memcached is read-heavy, the LSM-tree test covers only the memory tier, and closures must be single-threaded. The Spark-like jobs used to criticize RBV are not evaluated.
- **Sampling rests on borrowed assumptions, on one platform.** Down-weighting recently validated closures assumes errors are reproducible and tied to code, taken from earlier studies. The 1.41× gain over random sampling is measured on injected faults, so it depends on how well they match real, possibly data-dependent defects. The scheduling policy relies on core-private execution units of Intel CPUs, and only one server type is used.

## Further Research

- A pool allocator for versioning metadata and coarser data annotations, which the authors leave for future work, to cut the runtime and memory costs.
- Testing against real defective cores or production error traces, including whether skipping recently validated closures holds for data-dependent faults.
- Closing the control-path and system call gaps, for example with checks where the control path selects the operator.
- Measuring strict safe mode end to end, and extending Orthrus to multi-threaded operators and to non-Intel hardware, where the configurable scheduling policy would need new placement rules.

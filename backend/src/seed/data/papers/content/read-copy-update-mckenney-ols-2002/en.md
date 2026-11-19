---
title: "Read Copy Update"
summary: McKenney and five co-authors describe read-copy update (RCU), where readers of a shared structure take no locks and a writer frees an old version only after a grace period, and compare seven Linux implementations by idle overhead, call_rcu() latency under dbench and patch size.
researchArea: Operating Systems
keywords: read-copy update, RCU, grace period, quiescent state, lock-free readers, Linux kernel, call_rcu, memory ordering
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Read-copy update is a mechanism for constructing highly scalable algorithms for accessing and modifying read-mostly data structures, while avoiding cacheline bouncing, memory contention, and deadlocks that plague highly scalable operating system implementations. In particular, code that performs read-only accesses may be written without any locks, atomic instructions, or writes to shared cachelines, even in the face of concurrent updates. We reported on the basic mechanism last year, and have produced a number of Linux patches implementing and exploiting read copy update. This paper evaluates performance of a number of read copy update implementations for non-preemptive Linux kernels, and outlines a new implementation targeted to preemptive Linux kernels.

## Overview

This paper was presented at the Ottawa Linux Symposium on 26-29 June 2002 (proceedings pages 338-367). Its authors are Paul E. McKenney, Dipankar Sarma, Andrea Arcangeli, Andi Kleen, Orran Krieger and Rusty Russell, from IBM, SuSE Labs and IBM Research. It is a sequel to a 2001 OLS paper on the basic mechanism, so it assumes the idea and spends its pages on how to build it in the Linux 2.4 and 2.5 kernels. The title in the PDF is "Read Copy Update", without the hyphen. The paper has no DOI.

The problem is a data structure that is read very often and changed rarely, such as a route cache or a list of loaded modules. A reader-writer lock lets readers run in parallel, but every reader still writes the lock word, so the cacheline bounces between CPUs. The paper's answer is to let readers run with no lock at all and to push the cost of safety onto the writer. For another look at what limits kernel code on many cores, see [Analysis of Linux Scalability](/papers/analysis-of-linux-scalability-to-many-cores), which lists a lock-free generation-counter protocol for dentry comparison among its fixes. [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) uses RCU in its lock-free page-table traversal.

Terms: a quiescent state is a point where all of a CPU's temporary variables (pointers used while traversing a structure) from before some time are dead. A grace period is an interval in which every CPU passes through at least one quiescent state. Worth knowing first: spin locks, context switches, per-CPU data and cache coherence.

## Contribution

- **The two-phase update discipline.** The writer first removes every permanent pointer to the item, then waits one grace period, then frees it. Searches that began before the first phase may still see the item, searches that begin after cannot, and the wait covers the former.
- **An API.** `synchronize_kernel()` blocks for a full grace period and may not be called with locks held or from BH or IRQ context. `call_rcu()` queues a function to run after one and never sleeps. The usual idiom replaces `kfree()` with a `call_rcu()` of a wrapper around it.
- **Quiescent states inferred, not timed.** The grace period is not a fixed duration. Kernel threads may not hold locks across a context switch, so they may not hold pointers into protected data either, and a context switch on a CPU is a quiescent state. Once every CPU has switched, the item can be freed.
- **A design space and seven implementations.** Batching, how the end of a grace period is deduced, polling mechanism, request queuing, the quiescent-state definition and the allowed contexts are the parameters. Table 1 lists X-rcu, rcu, rcu-poll, rcu-ltimer, rcu-taskq, rcu-sched and rcu-preempt.
- **Applications.** A patch for the Linux IP route cache, a one-line patch that waits a grace period before `free_module()` frees a module structure, and a note on memory ordering for lock-free insertion.
- **A preemptible variant.** rcu-preempt tracks tasks that were preempted, per CPU, and counts only voluntary context switches as quiescent states.

## Methodology

The paper is an implementation and measurement report. Each variant is described with the code of `call_rcu()`, the scheduler hook and the timer or tasklet processing, and compared on three axes: idle overhead (Table 2), `call_rcu()` latency under the dbench benchmark on an 8-CPU 700MHz Pentium III Xeon with 1MB L2 caches and 6GB of memory using the dcache-rcu patch (Figures 9 and 10), and patch size in lines of unified diff (Table 3). A chat benchmark with 20 rooms and 500 messages on a 4-CPU machine with 1GB tests whether longer latency costs throughput (Figure 11). The route cache result uses the same 8-CPU machine with a workload that sends a fixed number of random-sized IP packets to one destination.

## Findings

- **Route cache.** After the patch, `ip_route_output_key()` overhead drops in Figure 6 (about 12,000 profile ticks for the base kernel against about 5,500 with RCU at 8 CPUs, read off the chart). Figure 7 shows total non-idle kernel ticks, so the gain does not come at the expense of other work. The authors call the overall speedup quite small because the change was made to validate the implementations, not to fix a known problem. They cite 30% for FD management and 25% for dcache management from other work.
- **Idle overhead.** rcu-taskq has none. rcu-poll and rcu-preempt add one local non-atomic increment in the scheduler. The others pay timer overhead when idle.
- **Latency.** rcu-poll keeps `call_rcu()` latency below 10 milliseconds under dbench, and below 250 microseconds on an idle system. X-rcu, rcu-ltimer and rcu have larger but bounded latencies. rcu-taskq grows with the number of clients. rcu-sched showed 14.5 seconds at 8 clients and 57.7 seconds at 4 clients, which the authors say they are investigating.
- **Chat benchmark.** The results show little sensitivity to the algorithm.
- **Complexity.** The patches range from 237 lines (rcu-taskq) to 742 (rcu-ltimer, of which 514 are for one architecture), with rcu-sched at 575 and 333 and rcu-preempt at 682.
- **Conclusions.** rcu-poll for workloads with few `call_rcu()` calls, the longer-latency variants for high rates, with measurements under heavy `call_rcu()` load still to come.
- **Memory ordering.** Insertion needs `wmb()` on the writer, and on Alpha readers need `rmb()` between fetching a pointer and dereferencing it. A `read_barrier_depends()` was proposed to spare other CPUs that cost.

## Critical Analysis

The paper is a snapshot of 2002 patches, and it says so. The claim that readers need no locks, atomics or shared writes is only for reads, and writers still use a spin lock to serialize updates (Figure 4). The cost shows up as memory held until a grace period ends, which the paper names as the key figure of merit but does not size in bytes.

Some points are thin. Comparison with other concurrent update mechanisms is delegated to other papers, so there is no head-to-head against reader-writer locks here beyond the route cache before and after. The text says rcu-sched uses no locks, interrupt masking, memory barriers or atomic instructions, yet its `call_rcu()` in Figure 28 executes `atomic_inc(&rcu_pending)` and Table 2 lists a global read. The rcu-sched latencies are unexplained, and the chat benchmark mixes several patches. The module patch is stated not to plug all unload races.

Later literature, not read here, with metadata checked only: the Linux kernel documentation (docs.kernel.org, "What is RCU?") lists a five-call API (`rcu_read_lock()`, `rcu_read_unlock()`, `synchronize_rcu()` or `call_rcu()`, `rcu_assign_pointer()`, `rcu_dereference()`), supports preemptible RCU readers and says readers that must block need SRCU. None of that is in this paper. Alglave, Maranget, McKenney, Parri and Stern, "Frightening Small Children and Disconcerting Grown-ups: Concurrency in the Linux Kernel" (ASPLOS 2018), and Gotsman, Rinetzky and Yang, "Verifying Concurrent Memory Reclamation Algorithms with Grace" (ESOP 2013), belong to the formal-semantics line that came after.

## Further Research

- **Preemption.** The authors plan to adapt more implementations to preemptible kernels and to choose the best one for 2.5.
- **More workloads.** Measurements under heavy `call_rcu()` load and on other benchmarks, including the route cache on workloads that stress it.
- **A full module-unload fix.** The one-line patch is meant as a basis for a complete solution.
- **Ordering primitives.** Replacing `rmb()` with `read_barrier_depends()`. For kernel bugs from missing barriers, see [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs).
- **Memory reuse.** Freed objects return to a kernel allocator, see [The Slab Allocator](/papers/slab-allocator-object-caching-kernel-memory-allocator), and the grace period delays that reuse.
- **Later systems work.** [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) and Clements, Kaashoek and Zeldovich, "Scalable address spaces using RCU balanced trees" (ASPLOS 2012, not read).

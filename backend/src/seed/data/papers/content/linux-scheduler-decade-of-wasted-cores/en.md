---
title: "The Linux Scheduler: A Decade of Wasted Cores"
summary: The authors found four bugs in the Linux CFS load balancer that leave cores idle for long periods while threads wait in runqueues, built a sanity checker and a trace visualizer to catch them, and measured slowdowns from 13% on kernel make to 138× on a barrier-heavy NAS benchmark.
researchArea: Operating Systems
keywords: linux scheduler, cfs, load balancing, numa, work conservation, performance bugs, scheduling domains
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

As a central part of resource management, the OS thread scheduler must maintain the following, simple, invariant: make sure that ready threads are scheduled on available cores. As simple as it may seem, we found that this invariant is often broken in Linux. Cores may stay idle for seconds while ready threads are waiting in runqueues. In our experiments, these performance bugs caused many-fold performance degradation for synchronization-heavy scientific applications, 13% higher latency for kernel make, and a 14-23% decrease in TPC-H throughput for a widely used commercial database. The main contribution of this work is the discovery and analysis of these bugs and providing the fixes. Conventional testing techniques and debugging tools are ineffective at confirming or understanding this kind of bugs, because their symptoms are often evasive. To drive our investigation, we built new tools that check for violation of the invariant online and visualize scheduling activity. They are simple, easily portable across kernel versions, and run with a negligible overhead. We believe that making these tools part of the kernel developers' tool belt can help keep this type of bug at bay.

## Overview

The Linux scheduler decides which runnable thread each core runs. Its default policy, the Completely Fair Scheduler (CFS), is simple on one core: threads sit in a red-black tree ordered by vruntime (runtime divided by weight) and the leftmost one runs. On a multicore machine every core gets its own runqueue, so a periodic load balancer has to keep the queues even, and that is where the complexity, and the bugs, live.

This EuroSys 2016 paper, by authors from Nice Sophia-Antipolis, EPFL, the University of British Columbia, Coho Data and Grenoble INP, shows that Linux often violates the most basic duty of a scheduler: never leave a core idle while another core has waiting threads. The topic sits next to the other scheduling and kernel papers in this library. [kSTEP](/papers/kstep-deterministic-testing-of-linux-cpu-scheduler-bugs) later studies 232 scheduler bug fixes and tests them deterministically, [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) and [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) move scheduling policy out of the kernel, and [Analysis of Linux Scalability to Many Cores](/papers/analysis-of-linux-scalability-to-many-cores), which this paper cites for earlier scalability bugs, is earlier work on multicore Linux.

Worth knowing first: runqueue, NUMA node, work-conserving scheduler (idle cores must take available work), and cgroups, which let the kernel divide a thread's load by the size of its group.

## Contribution

- **Four performance bugs in CFS.** Group Imbalance, Scheduling Group Construction, Overload-on-Wakeup and Missing Scheduling Domains, each with a root cause in the code and a fix. None crashes the system: they silently idle cores.
- **The invariant.** "No core remains idle while another core is overloaded." It is the work-conserving property, and the authors use it as the test for every bug.
- **An online sanity checker.** Unlike an assertion, it tolerates short violations and flags only those that persist.
- **A scheduler visualizer.** It records runqueue sizes, runqueue loads and the cores considered by each balancing or wakeup decision, and plots them over time.
- **A design argument.** Optimizations for modern hardware turned a simple policy into a complex one, so the authors propose a core module that keeps the invariant plus optimization modules that only make suggestions.

## Methodology

Experiments ran on a 64-core, 8-node NUMA server with eight Opteron 6272 CPUs at 2.1 GHz, 512 GB of DDR-3 and HyperTransport 3.0 links, where some nodes are two hops apart. The authors first noticed unexplained slowness running TPC-H on a widely used commercial database (never named), then used their visualizer on a multi-user workload: a 64-thread kernel make plus R processes launched from different ttys, NAS benchmarks, and TPC-H. Each bug was diagnosed from traces, fixed in the kernel, and compared before and after. The tools were first built on Linux 3.17 and ported to 4.3.

The checker runs every S = 1 s. When it sees an idle core and an overloaded core that can steal from it, it watches thread migration, creation and exit for M = 100 ms, and only if the state persists does it profile with SystemTap for 20 ms. The visualizer needs under 150 lines of kernel changes and stores events of 20 bytes in a static array.

## Findings

All numbers below are reported by the authors, from the 64-core machine.

- **Group Imbalance** (since 2.6.38). Cores compare the average load of scheduling groups, and with autogroups a thread of a 64-thread make carries about 64 times less load than a single R thread. The fix compares minimum load instead. Make finished 13% faster, and lu from NAS with 60 threads plus four R processes ran 13× faster.
- **Scheduling Group Construction** (since 3.9). Groups are built from the point of view of core 0, so two nodes two hops apart appear together in every group and never balance. With `taskset` on nodes 1 and 2, speedups from the fix ranged from 1.33× (is) to 3.63× (ua), and 27× for lu (1040 s down to 38 s).
- **Overload-on-Wakeup** (since 2.6.32). A woken thread only considers cores of the waker's node, so it can land on a busy core while other nodes sit idle. The fix wakes it on its previous core if idle, else on the longest-idle core, but only when power management forbids low-power states. In TPC-H, query 18 went from 55.9 s to 43.5 s (22.2%) and the full benchmark from 542.9 s to 471.1 s (13.2%). Adding the Group Imbalance fix gave 22.6% and 14.2%.
- **Missing Scheduling Domains** (since 3.19). After disabling and re-enabling a core through /proc, the call that rebuilds domains across NUMA nodes was lost in a refactoring, and all new threads stay on one node. With 64 threads, speedups from the fix ran from 4× (ep) to 24.9× (cg), 64.27× (ua) and 137.59× (lu, 2196 s down to 16 s, the "138×").
- **Tools.** The sanity checker costs under 0.5% with up to 10,000 threads, SystemTap profiling about 7% while active. Porting from 3.17 to 4.3 changed one line. The busiest workload produced about 186,200 events per second, or 3.6 MB of trace per second.

## Critical Analysis

The paper is candid about its limits, and the superlinear slowdowns are explained, not hidden: spinlocks and spin-barriers punish a descheduled lock holder.

- **Linux 4.3 did not cure it.** The authors confirmed that the new load metric in 4.3 left Group Imbalance in place, so a cleaner metric alone was not enough.
- **The fixes were not yet upstream.** The paper says they "will be submitted" to the kernel developers, so it does not claim acceptance.

The following points are a reading of the evidence, not claims of the paper.

- **One machine, one vendor.** Every figure comes from an 8-node Opteron, and the largest effects need nodes two hops apart, a specific cgroup layout or a core taken offline and back. The paper does not show how often typical servers hit them.
- **Worst cases dominate the headline.** The 138× and 27× come from lu, a pipeline benchmark the authors call extreme. Realistic gains are the 13% to 24% range.
- **Weak statistical detail.** Table 2 is an average of five runs, but no variance is given, the database is unnamed and the TPC-H configuration is not described.
- **Energy is asserted, not measured.** "Energy waste is proportional" appears in the introduction, and the Overload-on-Wakeup fix is disabled when cores may enter low-power states.
- **The checker finds one symptom.** It detects idle cores next to overloaded ones, so other scheduling errors such as poor NUMA placement would pass.
- **Book vs today (later literature, not in the paper).** The Linux kernel documentation says the scheduler moved from CFS to EEVDF in version 6.6, so the code studied here has since been replaced, and the same documentation describes sched_ext, a scheduler class defined by BPF programs. Whether each of these four bugs is fixed in current kernels is not claimed here. kSTEP in this library speaks to the testing gap the paper identified.

## Further Research

- The modular scheduler the authors envision: how should conflicting suggestions from cache-affinity, contention and load-balancing modules be combined?
- Visualization of large traces when the user does not know what to look for, which the paper calls an open problem.
- Formal and model-checking methods that can reason about time, since transient violations are acceptable and only long ones are bugs.
- Whether the sanity checker idea generalizes to other work-conservation invariants, for example across containers or heterogeneous cores.

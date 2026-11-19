---
title: "An Analysis of Linux Scalability to Many Cores"
summary: Boyd-Wickizer and colleagues run seven kernel-intensive applications on Linux 2.6.35-rc5 with 48 cores, find the kernel bottlenecks one by one, and remove them with 16 local changes (3002 changed lines, plus the new sloppy counter), concluding that traditional kernel designs have no scalability reason to be abandoned yet.
researchArea: Operating Systems
keywords: Linux scalability, multicore, MOSBENCH, sloppy counters, lock contention, per-core data structures, false sharing, dentry cache, 48 cores
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This paper analyzes the scalability of seven system applications (Exim, memcached, Apache, PostgreSQL, gmake, Psearchy, and MapReduce) running on Linux on a 48-core computer. Except for gmake, all applications trigger scalability bottlenecks inside a recent Linux kernel. Using mostly standard parallel programming techniques (this paper introduces one new technique, sloppy counters), these bottlenecks can be removed from the kernel or avoided by changing the applications slightly. Modifying the kernel required in total 3002 lines of code changes. A speculative conclusion from this analysis is that there is no scalability reason to give up on traditional operating system organizations just yet.

## Overview

Around 2010 many researchers argued that kernels built for a few cores would stop scaling as chips gained more, and proposed new designs: Barrelfish, Corey and fos. This OSDI 2010 paper from MIT CSAIL asks the plain question: how far does an ordinary Linux get? It is a measurement-and-repair study, not a new operating system. The authors modify the kernel (and sometimes the application) until each workload scales or the remaining limit is traced to something else.

The setting is the monolithic, shared-memory design that [UNIX](/papers/unix-time-sharing-system) popularized, in contrast with the library-operating-system line of the [exokernel](/papers/exokernel-os-architecture-application-level-resource-management), which shares an author (Kaashoek) with this paper. The memory-management side is revisited by [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness), which reuses two of these benchmarks. Reference counting, the target of the sloppy counters, is the subject of the bug study in [Refcounting bugs in Linux](/papers/refcounting-bugs-in-all-modern-linux-kernels).

Worth knowing first: Amdahl's Law (a small serial part caps the speedup), cache coherence (writing a line another core holds forces an invalidation round trip), and false sharing (two unrelated variables on one cache line).

## Contribution

- **16 kernel scalability improvements.** They produce the patched kernel PK from Linux 2.6.35-rc5. Figure 1 of the paper lists them; the fixes add 2617 lines and remove 385.
- **Sloppy counters.** One logical counter becomes a shared central counter plus per-core counts of spare references. A core takes a spare local reference when it has one and touches the central counter only otherwise. Existing uses of the counter need no change, which suits Linux because only a few uses of a counter are bottlenecks. The authors note two costs: space grows with the core count, and reconciling the counters is expensive, so they suit objects that are rarely freed.
- **MOSBENCH.** The seven applications are released publicly as a benchmark suite for operating-system scalability.
- **The kernel fixes.** Per-core accept backlog queues for listening sockets; sloppy counters for dentry, vfsmount, dst entry and protocol-memory counts; a lock-free generation-counter protocol for dentry comparison; per-core open-file lists, per-core vfsmount caches and per-core packet-buffer free lists; separating read-mostly fields onto their own cache lines; local-node DMA buffer allocation; avoiding the inode and dcache list locks and the per-inode mutex in `lseek`; finer-grained super-page locks; and non-caching instructions to zero super-pages.
- **An argument** that no immediate scalability reason justifies abandoning traditional kernel designs.

## Methodology

The machine is a Tyan Thunder S4985 with eight 2.4 GHz 6-core AMD Opteron 8431 chips (48 cores, 8 GB of DRAM per chip) and a 10 Gbit Intel 82599 (IXGBE) card, with client machines on a switch. Applications that modify files run on tmpfs to avoid disk waits, which the authors state makes the stress on the kernel higher than a real deployment and the absolute results unrepresentative. Fewer-core runs disable the other cores, and each run is repeated 3 times, keeping the best throughput. The workloads are deliberately kernel-heavy: Exim (69% of one-core time in the kernel), memcached (80%), Apache (60%), PostgreSQL (1.5% at one core, 82% at 48 in a read-only run), gmake, Psearchy (pedsort) and Metis. The loop is iterative: measure, locate the bottleneck, fix the kernel or the application, repeat, because each fix exposes the next. Results are plotted as throughput per core, where a flat line is perfect scaling.

## Findings

The numbers below are the paper's own.

- **Per application.** gmake runs 35 times faster on 48 cores than on one, on both kernels, limited by serial stages and stragglers. Exim on stock Linux collapses toward zero per-core throughput because of the vfsmount table spin lock, and PK scales far better. memcached gains about 30% from local-socket packet allocation and 30% at 48 cores from removing one falsely shared line in `net_device`.
- **PostgreSQL.** Two causes: its own lock manager (16 global mutexes, raised to 1024 with a lock-free uncontended path) and the kernel's `lseek`, whose inode mutex starved under contention and pushed system time from 1.7 to 322 microseconds per query between 32 and 48 cores. PK removes the mutex.
- **Psearchy and Metis.** Threaded pedsort spent 41 s of system time at 48 cores versus 2.3 s at one, because one per-process mutex serializes `mmap` and `munmap`. About 10 lines changed to use processes. Metis improved with 2 MB super-pages and finer super-page locks.
- **What still limits scaling (Figure 12).** All remaining limits are non-kernel: Exim spool directories (application), memcached transmit and Apache receive queues of the NIC (hardware), PostgreSQL a spin lock (application), gmake serial stages, pedsort cache capacity, and Metis DRAM throughput (50.0 of 51.5 Gbyte/s). Apache's NIC receive FIFO overflows while clients send only 2 Gbit/s and 2.8 million packets/s.
- **Conclusion.** Most kernel bottlenecks fell to modest, localized changes, so the authors conclude the Linux design is consistent with MOSBENCH scalability to 48 cores.

## Critical Analysis

The paper states its own limits: the conclusion is "speculative", disk I/O is removed, some workloads are synthetic, and more cores or other applications will expose new bottlenecks (thread and process creation are named as likely candidates). It does not claim that Linux scales for all workloads, that the changes were upstreamed, or that a new design could not do better in absolute terms.

The following points are a reading of the evidence, not claims of the paper.

- **The claim is about these seven applications.** "Modest changes suffice" is shown by a sample of workloads the authors chose partly because they stress the kernel, and application changes also carry weight (memcached run as one instance per core, Exim spool directories, pedsort processes, PostgreSQL's lock manager).
- **Two limits are attributed to hardware by inference.** The NIC limits for memcached and Apache rest on card counters and a microbenchmark, not on a run with a different card.
- **Effort counts as evidence.** 3002 changed lines is small, but it measures how local the fixes were, not how maintainable they are across kernel versions.

Later literature, not part of this paper: the authors' own [Scalable Commutativity Rule](https://doi.org/10.1145/3068914) (Clements, Kaashoek, Kohler, Morris, Zeldovich, CACM 2017) formalizes an interface-driven approach to scalable software, related to the paper's speculation about the system-call API, and Clements, Kaashoek and Zeldovich's ["Scalable address spaces using RCU balanced trees"](https://doi.org/10.1145/2150976.2150998) (ASPLOS 2012) addresses address-space scalability with RCU balanced trees. CortenMM, above, is a recent virtual-memory redesign evaluated against Linux on 384 cores.

## Further Research

- Which of the 16 fixes were generalized or replaced in later Linux releases, and how many cores before the next bottlenecks appear?
- Thread and process creation costs across cores, which the paper expects to grow.
- Whether the shared-memory, cache-coherent assumption survives hardware without fast coherence, which the paper raises.
- Applying the multicore-research techniques the paper lists (address ranges, dedicated cores, message passing over shared memory) to Linux.

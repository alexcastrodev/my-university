---
title: "Algorithms for Scalable Synchronization on Shared-Memory Multiprocessors"
summary: Mellor-Crummey and Scott show that busy-wait locks and barriers need not cause memory or interconnect contention if each processor spins on its own locally accessible flag, and introduce the MCS queue lock and a tree barrier, measured on a Sequent Symmetry and a BBN Butterfly.
researchArea: Operating Systems
keywords: spin lock, MCS lock, queue lock, barrier synchronization, local spinning, contention, fetch-and-store, compare-and-swap, shared-memory multiprocessor
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Busy-wait techniques are heavily used for mutual exclusion and barrier synchronization in shared-memory parallel programs. Unfortunately, typical implementations of busy-waiting tend to produce large amounts of memory and interconnect contention, introducing performance bottlenecks that become markedly more pronounced as applications scale. We argue that this problem is not fundamental, and that one can in fact construct busy-wait synchronization algorithms that induce no memory or interconnect contention. The key to these algorithms is for every processor to spin on separate locally-accessible flag variables, and for some other processor to terminate the spin with a single remote write operation at an appropriate time. Flag variables may be locally-accessible as a result of coherent caching, or by virtue of allocation in the local portion of physically distributed shared memory.

We present a new scalable algorithm for spin locks that generates O(1) remote references per lock acquisition, independent of the number of processors attempting to acquire the lock. Our algorithm provides reasonable latency in the absence of contention, requires only a constant amount of space per lock, and requires no hardware support other than a swap-with-memory instruction. We also present a new scalable barrier algorithm that generates O(1) remote references per processor reaching the barrier, and observe that two previously-known barriers can likewise be cast in a form that spins only on locally-accessible flag variables. None of these barrier algorithms requires hardware support beyond the usual atomicity of memory reads and writes.

We compare the performance of our scalable algorithms with other software approaches to busy-wait synchronization on both a Sequent Symmetry and a BBN Butterfly. Our principal conclusion is that contention due to synchronization need not be a problem in large-scale shared-memory multiprocessors. The existence of scalable algorithms greatly weakens the case for costly special-purpose hardware support for synchronization, and provides a case against so-called "dance hall" architectures, in which shared memory locations are equally far from all processors.

## Overview

This 1991 ACM Transactions on Computer Systems article, from Rice and the University of Rochester, is the origin of the MCS lock (named after the authors' initials). It dates from machines with a handful to a few hundred processors, when many researchers expected synchronization hot spots to require special hardware: combining networks, synchronization variables in switches, or lock queues in cache controllers. The paper cites a simulation by Agarwal and Cherian in which synchronization accounted for as much as 49 percent of network traffic on a 64-processor "dance hall" machine. Its answer is a software one: if many processors poll one variable, traffic piles up there, so give each processor its own variable and let one write wake it.

The same concern runs through the catalog. [An Analysis of Linux Scalability to Many Cores](/papers/analysis-of-linux-scalability-to-many-cores) finds a spin lock collapsing Exim at 48 cores, and [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) mixes reader locks, spin locks and RCU. [Read Copy Update](/papers/read-copy-update-mckenney-ols-2002) attacks contention differently, by removing locks from readers. [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) verifies ticket and MCS locks. [The Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) avoids shared state altogether.

Worth knowing first: test-and-set, cache coherence and invalidation, NUMA-style local versus remote memory, and why a spinning waiter costs bus or network bandwidth.

## Contribution

- **The MCS lock.** Each processor queues a `qnode` (a next pointer and a `locked` flag) in memory local to it. The lock holds a pointer to the tail. Acquire does a `fetch_and_store` of its node into the tail and, if there was a predecessor, links in behind it and spins on its own flag. Release hands the lock to the successor with one write. It is FIFO, needs constant space per lock and O(1) network transactions per acquisition, with or without coherent caches.
- **Compare-and-swap is optional.** With it, a releaser with no visible successor swaps the tail back to nil. Without it, Figure 7 repairs the queue using extra `fetch_and_store` calls, at the cost of strict FIFO (acquisitions stay "very nearly FIFO in practice", with a theoretical starvation risk).
- **A tree barrier.** Two P-node trees: arrival with fan-in 4 and wakeup with fan-out 2. Each processor spins only on a statically placed flag in its own node, using only reads and writes. It performs 2P-2 network transactions, which the paper argues is the minimum without broadcast, and O(log P) on the critical path.
- **Local spinning for older barriers.** The dissemination barrier (Hensgen, Finkel and Manber) and a tournament barrier with a wakeup tree are recast so every flag is statically assigned and local. The paper also introduces proportional backoff for the ticket lock and the centralized barrier.

## Methodology

Algorithms are given in pseudo-code and compared by network transactions, critical path, space and required atomic operations. Implementations were measured on a BBN Butterfly 1 (distributed memory, no coherent caches, 8 MHz MC68000 nodes, remote read about 4 microseconds, roughly five times a local one; tests up to 80 processors) and a Sequent Symmetry Model B (shared bus, snooping caches, 16 MHz 80386, up to 30 processors; plots to 18). Each point averages many operations: 10^5 lock acquisitions on the Butterfly, 10^6 on the Symmetry, 10^5 barriers on both, with interrupts disabled or processes bound to processors. Neither machine has compare-and-swap, so the MCS lock was measured with the Figure 7 release. Latency was also probed by timing access to each node's network interface. Code was offered by anonymous ftp. The correctness argument is only sketched, with details left to a technical report.

## Findings

All numbers are from the paper's text and tables. Slopes come from linear regression on Butterfly timings.

- **Spin locks, Butterfly.** Time per acquire/release grows by 7.4 microseconds per extra processor for test-and-set, 7.0 for a ticket lock without backoff and 5.0 for test-and-set with linear backoff. Anderson's array lock grows 0.4. Excluding runs below 10 processors, test-and-set with exponential backoff, ticket with proportional backoff and MCS grow 0.025, 0.021 and 0.00025 microseconds per processor.
- **Spin locks, Symmetry.** Test-and-test-and-set scales worst. MCS, Anderson's lock and test-and-set with exponential backoff scale extremely well with comparable absolute performance, with a 6.48 microsecond critical section. The MCS lock shows a peak at two processors, which the authors tie to the missing compare-and-swap.
- **Uncontended latency (Table I).** Butterfly: 34.9 (test-and-set), 38.7 (ticket), 65.7 (Anderson), 71.3 (MCS) microseconds. Symmetry: 7.0, not applicable, 10.6, 9.2. On the TC2000, 8.1 versus 12.2 microseconds for test-and-set and MCS.
- **Network impact (Table II).** With 60 processors on the Butterfly, latency rose at the lock node by 1420 percent (test-and-set), 992 (ticket), 75 (Anderson) and 4 (MCS), and at an idle node by 96, 97, 67 and 2.
- **Barriers, Butterfly.** The best centralized barrier (proportional delay) needed over 1.4 ms at 80 processors. The tree, tournament and dissemination barriers grow logarithmically. The tournament needs 2⌈log2 P⌉ rounds against ⌈log2 P⌉ for dissemination, about twofold slower, and the tree lies between.
- **Barriers, Symmetry.** Dissemination needs O(P log P) bus transactions and loses to the other four for P > 8. A centralized sense-reversing barrier is fastest below the largest processor counts tested, while the arrival tree with a central wakeup flag wins for large P in the authors' extrapolation.
- **Why locality matters.** Forcing all spinning through the network on the Butterfly added 27.8 (tree) and 9.4 (dissemination) microseconds per processor, factors of 11.8 and 6.8 at 84 processors. Table III: with 60 processors, network latency rose 10 and 18 percent with local polling and 124 and 117 with network polling.
- **Hardware.** On the Symmetry, special-purpose mechanisms such as QOLB are unlikely to beat MCS by more than 30 percent.

## Critical Analysis

The paper is careful about scope, and several limits are its own.

- **Atomic instructions required.** MCS needs `fetch_and_store`. Barriers need only reads and writes. The Butterfly's 16-bit atomics could not hold 24-bit pointers, so MCS used array indices. The Butterfly's atomics were costly, which inflates its latency numbers.
- **Fairness and preemption.** FIFO locks waste CPU if a spinning waiter is preempted. The paper names coscheduling, or a test-and-set lock with exponential backoff, as remedies, and measures neither.
- **Barrier results depend on the machine.** Its own recommendations differ for coherent broadcast, directory and no-cache machines, and the centralized barrier adapts best when the number of processors changes.

Not claimed by the paper: anything about multi-level caches, multi-socket NUMA, or machines of this decade. The machines described have at most 256 simple nodes (Butterfly) or 30 processors with one cache each (Symmetry). My own limits: curve-only results (the Butterfly graphs beyond the slopes and the 1.4 ms figure the text gives) are not quoted here, and the correctness proof, which lives in a technical report, was not available to me.

Later literature (not part of the paper, and my checks are limited). I read Corbet's 2014 LWN article "MCS locks and qspinlocks", by way of a fetched excerpt, not the kernel source. It says MCS locks were not used for general Linux spinlocks because ticket spinlocks fit in 32 bits and MCS does not, and that qspinlock keeps a per-CPU array of four MCS nodes. The catalog page on CertiKOS reports an uncontended cost of 34 cycles for a ticket lock against 74 for MCS on its machine, which I took from that page without reading the original. I have not read the NUMA-aware lock literature, so I make no claims about it. A different, later (2013) line of work is [The Scalable Commutativity Rule](/papers/the-scalable-commutativity-rule). By the catalog analysis of that paper, it asks when an interface permits an implementation whose operations write no cache line that another core reads or writes, and reports Linux 3.8 conflict-free for 68% of 13,664 generated tests of 18 POSIX calls and the authors' sv6 kernel for 99%. That page does not discuss MCS locks, so how the two relate is my reading: a lock like MCS makes unavoidable sharing cheaper, while the rule says when the interface need not share at all.

## Further Research

- How MCS-style queues behave when waiters are preempted, in virtualized or oversubscribed systems, which the paper only mentions.
- Locks that keep MCS-like local spinning while fitting the compact word size kernels require.
- Repeating the Butterfly versus Symmetry comparison on current multi-socket machines with deep cache hierarchies.
- Machine-checked proofs of the lock and barrier algorithms, such as those in CertiKOS, replacing the sketched argument.

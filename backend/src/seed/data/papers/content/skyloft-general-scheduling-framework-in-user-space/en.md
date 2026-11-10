---
title: "Skyloft: A General High-Efficient Scheduling Framework in User Space"
summary: Skyloft is a Linux-compatible library OS plus a 325-line kernel module that runs scheduling policies entirely in user space, using Intel user interrupts (and a trick that routes the local APIC timer to user space) to preempt threads every few microseconds and to share cores among applications.
researchArea: Operating Systems
keywords: user-space scheduling, user interrupts, uintr, microsecond-scale preemption, tail latency, work stealing, kernel bypass
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Datacenter services want custom scheduling policies for tail latency, throughput and CPU efficiency, but changing the Linux scheduler is hard, and every decision taken in the kernel costs mode switches and locality. Schedulers that run in user space avoid that cost, yet the authors argue that none offers both things a general framework needs. The first is microsecond-scale preemption, so that a long request cannot block short ones when service times are heavy-tailed. The second is sharing cores among several applications, so that idle cores of a latency-critical (LC) application go to a best-effort (BE) one and come back quickly under a burst. Shinjuku and Concord preempt but dedicate cores to one application, while Shenango reallocates cores fast but lacks preemption inside an application.

This SOSP 2024 paper (Austin), from Tsinghua University and the Quan Cheng Laboratory, presents Skyloft, a user-space scheduling framework built on Intel User Interrupts (UINTR, available on Sapphire Rapids) and run alongside Linux on isolated cores.

Four terms are worth keeping straight. UINTR lets hardware deliver an interrupt straight to a user-space handler, and SENDUIPI is the instruction that sends one. The Skyloft LibOS is the user-space part, with a POSIX-style threading API, and the Skyloft kernel module is the small privileged part. The Single Binding Rule is the invariant that keeps the Linux scheduler out of the way.

Worth knowing first: head-of-line blocking and why processor sharing helps under heavy-tailed service times, and how an OS delivers timer interrupts. [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) is the paper's main general-purpose comparison, a framework that delegates Linux scheduling to user-space agents. [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) is cited among the dataplane OSes whose datapath ideas Skyloft reuses. Two pairings of mine, not the paper's: [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs) fights the same head-of-line blocking by moving message scheduling into the kernel instead of out of it, and [Snap](/papers/snap-microkernel-approach-to-host-networking) is another Google system that moves a kernel function (host networking) to user space.

## Contribution

- **User interrupts as the preemption primitive.** Skyloft supports two ways to preempt. A dispatcher core can send user IPIs with SENDUIPI, which suits centralized policies but costs a core and, as the authors note, becomes a bottleneck with many cores. Or each core can take its own timer interrupt in user space, which suits per-CPU policies and needs no dispatcher.
- **Hardware timer interrupts in user space.** The authors say neither prior work nor Intel's manual covers this. Pointing the UINV register at the timer vector makes the core recognize the interrupt, but nothing fills the PIR field of the UPID, so no user-interrupt processing starts. Their fix is to set the SN (Suppress Notification) bit and have each core run SENDUIPI to itself, which fills the PIR without sending a real IPI, and the handler repeats it for the next tick. This required changing 163 lines of the Linux UINTR patch.
- **Many applications, one core, one active thread.** Cores are isolated at boot. Each application creates one kernel thread per isolated core, and the Single Binding Rule allows only one active kernel thread per core, so the kernel scheduler is bypassed. Switching user threads inside an application stays in user space. Switching to another application's thread calls the kernel module, which suspends one kernel thread and wakes the other atomically. All applications link an identical copy of the library and share runqueues, application metadata and thread state in shared memory, while contexts and stacks stay private.
- **A small policy interface.** A policy implements task_init, task_terminate, task_enqueue, task_dequeue, task_block and task_wakeup, plus sched_init and sched_timer_tick, sched_balance for per-CPU policies and sched_poll for centralized ones. A global user-interrupt handler calls sched_timer_tick, requeues the current task if it says to preempt, and re-enters the scheduling loop.
- **I/O and size.** DPDK polls the NIC on a dedicated core and hands packets to isolated cores through shared ring buffers by RSS hash, with a lightweight user-space TCP and UDP stack. The LibOS is 9K lines of C, the DPDK and network code another 4K, and the kernel module 325. Table 4 lists the policies: Round-Robin 141 lines, CFS 430, EEVDF 579, Shinjuku 192, Shinjuku-Shenango 444 and a preemptive work-stealing policy 150, against 6,592 for Linux CFS and 710 for ghOSt's Shinjuku.

## Methodology

The server has two 24-core Xeon Gold 5418Y CPUs at 2.0 GHz and 128 GB of RAM, with TurboBoost, idle states, frequency scaling and transparent hugepages disabled, and a 10 Gb/s Intel 82599ES NIC. Most runs use a modified Linux 6.0.0 and DPDK 22.11, and a separate dual-socket client sends open-loop Poisson load.

Per-CPU policies are compared with Linux RR, CFS and EEVDF (default and tuned) on schbench v1.0 with 24 cores, one message thread and a growing number of workers. Centralized policies run a synthetic workload of 99.5% requests of 4 µs and 0.5% of 10 ms, with one dispatcher and 20 workers, against the original Shinjuku (Linux 4.4), ghOSt's Shinjuku agent (Linux 5.11) and a non-preemptive CFS version. A second run co-locates the LC application with a batch application using Shenango's core-allocation strategy. Real applications are Memcached 1.5.6 with the USR mix (99.8% GET, 0.2% SET, 4 workers) and a UDP RocksDB 6.15.5 server with 50% GET (0.95 µs) and 50% SCAN (591 µs) on 14 workers, both against Shenango with a work-stealing policy. Microbenchmarks measure interrupt, timer, thread and application-switch costs.

## Findings

These are the authors' reported results.

- **Wakeup latency.** Skyloft's RR, CFS and EEVDF show significantly lower 99% wakeup latency than their Linux counterparts, and the abstract gives 100 µs against 10,000 µs. Skyloft's EEVDF beats its CFS, Linux EEVDF behaves like Linux CFS because it is limited by the timer frequency, and latency is roughly proportional to the time slice.
- **Single application.** A 30 µs quantum gave the best results. Skyloft and Shinjuku perform similarly, ghOSt reaches 80.1% of Skyloft's maximum throughput with a 99% tail latency at low load three times higher, and Linux CFS reaches 58.7%.
- **LC plus batch.** Skyloft matches the original centralized policy's tail latency, beats ghOSt by 19% in maximum throughput with 33% lower 99% tail latency, and keeps a batch CPU share similar to Linux and ghOSt. Shinjuku cannot give the batch application any share.
- **Memcached.** Skyloft stays within 2% of Shenango's maximum throughput and has slightly lower tail latency at low load, since Shenango pays for core adjustments even with one application.
- **RocksDB.** With a 5 µs quantum and a target 99.9% slowdown of 50×, Skyloft sustains 1.9× the load of Shenango. Emulating the timer on a dedicated core (13 workers) loses 13% against the local APIC timer (14 workers).
- **Preemption cost (cycles, Table 6).** A user IPI costs 167 to send, 661 to receive and 1,211 to deliver, against 437, 1,582 and 1,345 for a kernel IPI and 1,224, 6,359 and 5,274 for a signal. A user timer interrupt costs 642 cycles against 5,057 for setitimer, and the extra SENDUIPI in the handler adds about 123.
- **Threads (ns, Table 7).** For pthread, Go and Skyloft: yield 898, 108, 37, spawn 15,418, 503, 191, condvar 2,532, 262, 86, and mutex 28, 25, 27. Switching between applications takes 1,905 ns, against 1,124 ns for Linux when both threads are runnable and 2,471 ns when one wakes the other.

## Critical Analysis

The Discussion section is open about what is unfinished. It concedes the following.

- **Trust and blocking.** A malicious application could tamper with the shared runqueue. Intel MPK could protect it, but the library and the application share an address space, so the application could change the permissions with WRPKRU, which prior work only partly addresses. A page fault or blocking system call stalls the core under the Single Binding Rule, and the fixes (io_uring, SPDK, userfaultfd) are proposals.
- **Costs still paid.** The timer is configured through the kernel, and switching applications suspends and wakes kernel threads, which the authors say a direct kernel operation could improve. Unmanaged Linux threads with manual CPU affinity on isolated cores can interfere, so they advise against setting affinity.

The following points are a reading of the evidence, not claims of the paper.

- **The wakeup gain is mostly a timer gain.** Table 5 gives Skyloft a 100,000 Hz timer against at most 1,000 Hz for Linux, and Figure 6 shows latency tracking the time slice. The 100 µs against 10,000 µs figure appears in the abstract and in a chart, and the body says only "significantly lower" and "orders of magnitude".
- **Baselines differ in kernel and era.** Shinjuku ran on Linux 4.4, ghOSt on 5.11 and Skyloft on 6.0.0, for reasons the authors give (Dune compatibility, porting effort). The 19% and 33% gains over ghOSt do not isolate that difference.
- **Multi-application is tested thinly.** Co-location is shown only with a synthetic LC workload and one batch application. Memcached and RocksDB ran alone, so real co-located applications, more than two applications and the 1,905 ns switch against a 5 µs quantum are not measured.
- **Small and single-platform.** One Sapphire Rapids server, with 4, 14 or 20 workers. The scalability claim over dispatchers rests on per-interrupt cycles and one result in which losing one of 14 cores costs 13%, more than the 7% of capacity that core represents, which the paper does not break down.
- **Closest rivals are discussed, not run.** LibPreemptible, which the authors call most similar in mechanism, Concord, Caladan and Perséphone are absent as baselines, so "first general framework" rests on a feature table (Table 1).
- **Lines of code mislead a little.** The 141 to 579 line policies sit on top of the 9K-line LibOS and the kernel module, while Linux CFS and ghOSt are whole subsystems.
- **Small inconsistencies.** The introduction says 1.2× over Shenango on RocksDB, while the abstract and Section 5.3 say 1.9×, and the body figure is used here. It also says "nearly 10×" for the timer, which is about 7.9× by Table 6 (5,057 over 642). Skyloft is "lowest for almost all" thread operations, and Go's mutex (25 ns) beats it (27 ns).
- **Out-of-tree dependency.** The results need Sapphire Rapids and a UINTR patch the authors modified, and the porting effort for Memcached and RocksDB is not reported.

## Further Research

- Letting applications reset the timer without the kernel, for which the authors point to User-Timer Events in Intel's future processors.
- Protecting the shared runqueue with MPK or VMFUNC and measuring its cost, and handling page faults and blocking I/O without breaking the Single Binding Rule.
- Delegating peripheral interrupts (I/O APIC, MSI) to user space for polling-free drivers, and a cheaper direct kernel thread switch between applications.
- A many-core evaluation with several real co-located applications against LibPreemptible, Concord and Caladan on one kernel.

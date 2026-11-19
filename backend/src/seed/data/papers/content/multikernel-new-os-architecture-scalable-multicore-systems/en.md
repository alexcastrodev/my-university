---
title: "The Multikernel: A New OS Architecture for Scalable Multicore Systems"
summary: Baumann and colleagues propose structuring the OS as a distributed system of cores that share no state and communicate by explicit messages, build Barrelfish to test it, and show that on 2009 AMD and Intel machines it is comparable to Linux and Windows on benchmarks, with better-scaling unmap and capability operations.
researchArea: Operating Systems
keywords: multikernel, Barrelfish, multicore, message passing, replicated state, URPC, TLB shootdown, system knowledge base, CPU driver, heterogeneous hardware
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Commodity computer systems contain more and more processor cores and exhibit increasingly diverse architectural tradeoffs, including memory hierarchies, interconnects, instruction sets and variants, and IO configurations. Previous high-performance computing systems have scaled in specific cases, but the dynamic nature of modern client and server workloads, coupled with the impossibility of statically optimizing an OS for all workloads and hardware variants, pose serious challenges for operating system structures. The authors argue that the challenge of future multicore hardware is best met by embracing the networked nature of the machine, rethinking OS architecture using ideas from distributed systems. They investigate a new OS structure, the multikernel, that treats the machine as a network of independent cores, assumes no inter-core sharing at the lowest level, and moves traditional OS functionality to a distributed system of processes that communicate via message-passing. They implemented a multikernel OS to show that the approach is promising, and describe how traditional scalability problems for operating systems (such as memory management) can be effectively recast using messages and can exploit insights from distributed systems and networking. An evaluation of the prototype on multicore systems shows that, even on present-day machines, the performance of a multikernel is comparable with a conventional OS, and can scale better to support future hardware.

## Overview

This SOSP 2009 paper, from ETH Zurich and Microsoft Research Cambridge, sits at a turning point: core counts were rising and hardware was becoming diverse (different caches, interconnects, even instruction sets), while kernels were still shared-memory programs with data structures protected by locks. The authors' claim is that the problem is the structure itself, not any one lock. Their answer is to treat the machine as a small network and build the OS the way one builds a distributed system.

The paper is the architectural counterpart of a measurement study such as [An Analysis of Linux Scalability to Many Cores](/papers/analysis-of-linux-scalability-to-many-cores), which asked a year later how far a patched Linux gets. It borrows from the [exokernel](/papers/exokernel-os-architecture-application-level-resource-management) (the CPU driver abstracts very little) and from [seL4](/papers/sel4-formal-verification-of-an-os-kernel) (Barrelfish's capability system is modeled on it). Two authors, Barham and Harris, also wrote [Xen](/papers/xen-and-the-art-of-virtualization). The bridge to distributed systems is explicit: replicated state kept consistent by agreement protocols, in the spirit of [the state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial) (the paper itself does not cite it), and messages that are pipelined and batched. Its future-work section notes that an OS structured as a distributed system matches popular datacenter programming models such as [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters).

Worth knowing first: cache coherence (a core writing a line forces other copies to be invalidated), TLB shootdown (when a mapping changes, every core that may cache it must flush), and two-phase commit.

## Contribution

- **The multikernel model.** The OS is a distributed system of cores that communicate by messages and share no memory (except the memory used for message channels). Three principles: make all inter-core communication explicit, make OS structure hardware-neutral, and view state as replicated instead of shared. Only the message transport and the interface to hardware (CPUs and devices) are machine-specific.
- **Barrelfish.** Each core runs a privileged-mode CPU driver, event-driven, single-threaded and non-preemptable, plus a user-mode monitor process. Monitors do all inter-core coordination and keep replicated structures (memory allocation tables, address space mappings) consistent with agreement protocols. The x86-64 CPU driver is 7135 lines of C and 337 of assembly. A process is a set of dispatcher objects, one per core.
- **URPC.** Between cores, a shared-memory region is a channel for cache-line-sized messages from a single writer to a single reader. The sender writes sequentially and the receiver polls the last word, so it never sees a partial message. Dispatchers poll briefly and then block.
- **The system knowledge base (SKB).** A subset of first-order logic, populated from hardware discovery (ACPI, PCI, CPUID), online measurements (URPC latency and bandwidth between all core pairs) and pre-asserted facts. Queries decide, for example, driver placement, message transports and multicast trees. Its first implementation is a port of the ECLiPSe constraint system.
- **Capabilities for memory.** Following seL4, all memory management goes through capability operations (retype, revoke), with virtual memory handled in user code.

## Methodology

The motivation is measured first. Figure 3 compares updating shared state on the 4×4-core AMD system two ways: threads that directly update 1, 2, 4 or 8 shared cache lines (SHM1 to SHM8, no locking) versus a client sending a lightweight RPC, assumed to fit in one 64-byte line, to a server that updates the data (MSG1, MSG8).

The evaluation uses four machines: 2×4-core Intel (Xeon X5355, 2.66 GHz), 2×2-core AMD (Opteron 2220, 2.8 GHz), 4×4-core AMD (Opteron 8380, 2.5 GHz) and 8×4-core AMD (Opteron 8350, 2 GHz, the interconnect of Figure 2). The goals are stated up front: performance comparable to existing systems, scalability, retargetability, exploiting pipelining and batching, and placement by topology. Tests: a TLB shootdown case study with four URPC protocols (Broadcast, Unicast, Multicast, NUMA-Aware Multicast) and an end-to-end unmap against Linux 2.6.26 (`mprotect`) and Windows Server 2008 R2 Beta (`VirtualProtect`); two-phase commit for capability retype; NAS OpenMP and SPLASH-2 on the 4×4 AMD machine against Linux; and IO workloads (IP loopback, UDP echo, a web server and database) against Linux with lighttpd 1.4.23.

## Findings

All numbers below are the paper's own.

- **Motivation (Figure 3).** One core updates in under 30 cycles, but with 16 cores modifying the same data each update costs almost 12,000 extra cycles, all spent stalled on cache misses. For updates of four or more cache lines the RPC latency is lower than shared memory (SHM4 versus MSG8), and the single server performs twice as many updates per second as all 16 shared-memory threads together.
- **Messaging costs.** The local same-core primitive takes 845, 757, 1463 and 1549 cycles on the four systems (Table 1). URPC latency ranges from 180 cycles (shared cache, 2×4 Intel, 11.97 messages per kilocycle) to 618 cycles (two hops, 8×4 AMD) (Table 2). On the 2×2 AMD, URPC takes 450 cycles versus 424 for an L4 IPC, with 3.42 versus 2.36 messages per kilocycle and fewer cache lines used (9 instruction and 8 data lines versus 25 and 13) (Table 3).
- **TLB shootdown.** Broadcast scales linearly with cores because of the AMD coherence protocol; Unicast is better but still linear; the two-level Multicast, and especially the NUMA-aware one, scale much better. The SKB builds the tree at runtime. Complete unmap in Barrelfish quickly outperforms Linux and Windows as the core count grows, even though up to 32 user-level processes take part, while both of the others pay the cost of serially sending IPIs. The authors attribute the large overhead over the baseline mostly to the unoptimized thread-library dispatch loop.
- **Capability retype.** Two-phase commit with the same multicast technique scales well, and with pipelining a retype consumes fewer cycles than IPI-based shootdowns on Windows and Linux.
- **Compute-bound.** On the 4×4 AMD, five applications (NAS CG, FT, IS; SPLASH-2 Barnes-Hut, radiosity) scale poorly on both systems, which the authors take to show that the distributed structure supports shared-address-space parallel code with little performance penalty.
- **IO.** IP loopback on the 2×2 AMD: 2154 Mbit/s versus 1823 for Linux, 21 versus 77 data-cache misses per packet (Table 4). UDP echo: 951.7 versus 951 Mbit/s. Static web page: 18697 requests per second (640 Mbit/s) versus 8924 (316 Mbit/s) for lighttpd. With SQLite behind URPC: 3417 requests per second, bottlenecked at the database core.

## Critical Analysis

The paper is careful about its limits. It says it "would be wrong to draw any quantitative conclusions" from the large-scale benchmarks, since Linux and Windows are mature and Barrelfish is new and lighter, and reads them only as evidence of reasonable performance. Stronger claims are made only for the microbenchmarks. It states that it does not address complex application workloads or higher-level services such as storage, does not evaluate scalability beyond the commodity hardware of the time, and does not evaluate heterogeneous cores (the machines are homogeneous Intel and AMD; the ARM port was in progress). The authors admit the capability system was, in hindsight, "unnecessarily complex" and no more efficient than scalable per-processor memory managers, and that splitting CPU driver and monitor is not optimal for performance (several thousand cycles per OS call). The whole machine is one failure unit, so fault tolerance is left aside.

What the paper does not claim: that a shared-memory kernel cannot scale (it says current OSes have point solutions), that messages beat shared memory in general, or that results transfer to hardware without coherence. It also does not show end-to-end gains on real application mixes.

The points below are a reading of the evidence, not claims of the paper.

- **The comparison baselines are 2008 systems.** Linux 2.6.26 and a Windows Server 2008 R2 Beta, with the unmap overhead left unoptimized, say little about later kernels.
- **The headline is partly the protocol.** The unmap win comes from a topology-aware multicast tree, which could in principle be built in a shared-memory kernel too. The paper argues the message abstraction makes it easier, not that it is the only way.

Later literature, not part of this paper: the MIT study [An Analysis of Linux Scalability to Many Cores](/papers/analysis-of-linux-scalability-to-many-cores) (OSDI 2010) concluded for seven kernel-heavy applications on 48 cores that modest kernel changes were enough, so there was no scalability reason to give up traditional organizations yet. Corey (Boyd-Wickizer et al., OSDI 2008), which the multikernel paper discusses, lets applications control sharing. For heterogeneous hardware, see Barbalace et al., "Popcorn: bridging the programmability gap in heterogeneous-ISA platforms" (EuroSys 2015, [doi](https://doi.org/10.1145/2741948.2741962)) and Asmussen et al., "M3: A Hardware/Operating-System Co-Design to Tame Heterogeneous Manycores" (ASPLOS 2016, [doi](https://doi.org/10.1145/2872362.2872371)). I only checked the titles and venues of these two, not their claims. A scheduling counterpoint on a shared Linux kernel is [The Linux Scheduler: A Decade of Wasted Cores](/papers/linux-scheduler-decade-of-wasted-cores).

## Further Research

- Limited sharing behind the replica interfaces: the authors name deciding when to share, and automating it, as an open question.
- Multicast, incast and anycast URPC transports, and scheduling based on queue lengths, since queuing effects caused performance anomalies.
- A scalable, replicated file system inside the machine, and a network stack designed for multikernels.
- Extending a multikernel beyond one machine to handle partial failures.
- Whether the results hold on non-coherent or truly heterogeneous hardware, which the paper did not measure.

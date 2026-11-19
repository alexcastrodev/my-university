---
title: "On µ-Kernel Construction"
summary: Liedtke argues that the poor performance and rigidity of the µ-kernels of the early 1990s (Mach above all) came from overloaded kernels and weak implementations, not from the idea itself. He derives a minimal set of kernel concepts (address spaces with grant, map and flush, threads with IPC, unique identifiers), shows from cycle counts and re-read measurements that kernel entry, address-space switches and IPC can be several times cheaper, and concludes that µ-kernels are inherently processor dependent.
researchArea: Operating Systems
keywords: µ-kernel, minimality, address spaces, IPC, L3, L4, Mach, non-portability
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

From a software-technology point of view, the µ-kernel concept is superior to large integrated kernels. On the other hand, it is widely believed that (a) µ-kernel based systems are inherently inefficient and (b) they are not sufficiently flexible. Contradictory to this belief, we show and support by documentary evidence that inefficiency and inflexibility of current µ-kernels is not inherited from the basic idea but mostly from overloading the kernel and/or from improper implementation.

Based on functional reasons, we describe some concepts which must be implemented by a µ-kernel and illustrate their flexibility. Then, we analyze the performance critical points. We show what performance is achievable, that the efficiency is sufficient with respect to macro-kernels and why some published contradictory measurements are not evident. Furthermore, we describe some implementation techniques and illustrate why µ-kernels are inherently not portable, although they improve portability of the whole system.

## Overview

Jochen Liedtke wrote this paper at GMD (the German National Research Center for Information Technology) for SOSP '95, Copper Mountain, Colorado, December 1995. It is a position paper with numbers. By then the µ-kernel idea was old (the paper cites Brinch Hansen 1970 and Hydra), but systems such as Mach had made it look slow, and the folklore blamed the extra user-kernel mode and address-space switches. Liedtke's answer is that this is a statement about one kernel's construction.

It sits next to two neighbours in the catalog. The [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) paper (same proceedings, same month) also wants a tiny, hardware-dependent kernel and compares itself with L3, and Liedtke answers it in his section 6. [The UNIX Time-Sharing System](/papers/unix-time-sharing-system) is the monolithic baseline in spirit, and [Hints for Computer System Design](/papers/hints-for-computer-system-design) shares the habit of treating performance as a design constraint from the start. [seL4](/papers/sel4-formal-verification-of-an-os-kernel) is a later L4-style kernel (the paper names L4 as the successor of L3 in its Availability note).

Worth knowing first: user and kernel mode, virtual memory and the TLB (tagged versus untagged), what a context switch costs, and the difference between a monolithic kernel and a kernel with user-level servers.

## Contribution

- **A minimality criterion.** A concept is tolerated inside the µ-kernel only if moving it outside, that is permitting competing implementations, would prevent the implementation of the system's required functionality. The criterion is functionality, not performance. Footnote 3 admits that minimality, necessity and completeness cannot be proved.
- **Address spaces with three operations.** Construction is recursive outside the kernel, starting from address space 0 (physical memory). The kernel offers grant, map and flush. Memory managers, pagers and file mappings sit on top.
- **Threads and IPC.** Threads are kept in the kernel because a thread's address-space association must be controlled by it. Cross-address-space communication is message-based IPC. Hardware interrupts become messages from special thread ids, and I/O ports are part of the address-space abstraction, so drivers run as ordinary processes.
- **Unique identifiers.** The kernel supplies uids unique in space and time, because encrypting local messages is too expensive and user-supplied capabilities can be duplicated without the receiver's control.
- **A defense of the concept.** Section 4 re-reads published measurements (Ousterhout, Chen and Bershad) and argues that the costs they report come from Mach's construction.
- **A non-portability thesis.** µ-kernels form the link between abstractions and the bare processor, so they are as hardware dependent as optimizing code generators.

## Methodology

The method is mostly analytic. Section 2 derives the primitives from functional requirements, section 3 sketches (without implementing here) how memory managers, pagers, drivers, a Unix server and remote communication can be built on them. Section 4 accounts for costs in cycles on a 486 at 50 MHz, chosen because kernel-user switches are expensive on x86. The author takes a best-case Mach number as the reference and compares it with the L3 kernel as an existence proof.

Evidence is of three kinds: the author's own measurement (18 µs per Mach `get_self_thread` call; L4 timings on a 90 MHz Pentium repeated 100,000 times), published numbers normalized to common units (Table 2), and a re-analysis of the Chen and Bershad memory-system data, comparing Ultrix with Mach plus a Unix server. Section 5 compares Exokernel on an R2000 with L3 on a 486, and the author says himself that this is like comparing apples with oranges. Appendix A gives a formal model of the three address-space operations and a mapping-tree implementation.

## Findings

All numbers are from the paper.

- **Kernel entry.** Mach on a 486 needs 18 µs, about 900 cycles. The hardware enter and return cost 71 and 36 cycles (107 in total, about 2 µs), so roughly 800 cycles are kernel overhead. L3 has a minimal kernel overhead of 15 cycles, and a complete L3 kernel call costs 123 to 180 cycles, mostly under 3 µs. The paper states this is 6 to 10 times better than existing kernels.
- **Address-space switches.** With segment registers, a switch costs 39 cycles on the 486, 15 on the Pentium and 29 on the PowerPC 601. The conclusion is under 50 cycles. On a Pentium at 90 MHz (Figure 2, with L4), an RPC plus working-set re-establishment takes 3.2 to 3.6 µs with segment switching against 6.3 to 12.7 µs with page-table switching, for 2 to 64 data pages.
- **IPC (Table 2).** The one-byte RPC round trip is 10 µs for L3 (486, 50 MHz, 250 cycles per one-way IPC) against 230 µs for Mach on the same CPU (5750 cycles), roughly 22 times faster according to the footnote. Other rows: QNX 76 µs, Mach on an R2000 190 µs, Spin 102 µs on an Alpha. Unix pipe ping-pongs were mostly 400 to 800 µs, so 10 µs is a 40 to 80 times speedup. The L3 figures are L3's, not L4's.
- **Memory effects.** The extra memory cycles per instruction of Mach over Ultrix (up to 0.25 for some programs) come from higher system cache consumption, not from conflicts inherent to the structure. L3 needs less than 1 KB of cache for short IPC.
- **Implementation techniques named.** Concentrating hot tables and kernel data in one page, control blocks and kernel stacks as virtual objects, and lazy scheduling, together saving 11 TLB misses (at least 99 cycles) and described as inevitable. Thread control blocks aligned on 1K rather than 4K for the Pentium cache. Large messages by mapping rather than copying. Segment-based multiplexing of user address spaces on the Pentium.
- **Non-portability.** Moving from 486 to Pentium changes algorithms in about half of all µ-kernel modules, even changes the bit layout of thread uids.

What the paper does not claim: that µ-kernels beat monolithic kernels on whole applications (it argues sufficiency, and the application benchmarks are not its own), that its primitives are proven minimal, that register-based message passing is the way to speed IPC (it is not discussed), or that Spin and Exokernel are worse (it calls the questions open).

## Critical Analysis

The central argument holds up well: cycle accounting separates conceptual costs from implementation costs, and L3 is a real existence proof. Limits to keep in mind:

- **Evidence is mostly indirect.** The IPC speedup is L3 against other systems' published numbers, on different CPUs and units, and the Exokernel comparison relies on estimates ("no more than 30 additional cycles") from experience. Whole-system results for a complete system are not in the paper.
- **Narrow benchmarks.** One-byte RPC and a null-ish kernel call are best cases. The paper also sketches flexibility in section 3 without measuring those servers.
- **Dated hardware.** Everything depends on the 486, Pentium, R2000 and Alpha TLBs and traps, and the paper itself says a new processor requires a new design.
- **Trust assumptions.** Unique identifiers over user-held capabilities is a design choice, not a result.

Later literature, marked as such: [seL4](/papers/sel4-formal-verification-of-an-os-kernel), whose catalog note reports a one-way IPC of 224 cycles on an ARM board against 206 for the hand-written OKL4 path, shows the L4 line still competing on IPC in 2009. Liedtke's own follow-up "Toward real microkernels" (CACM, September 1996, checked in Crossref, not read here) revisits the topic. For microkernel-style ideas in current systems, see [Snap](/papers/snap-microkernel-approach-to-host-networking), [TreeSLS](/papers/treesls-whole-system-persistent-microkernel-with-tree-structured-checkpoint) and [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus). These pairings are mine, not the paper's.

## Further Research

- Comparing well-engineered abstraction-based and exo-style µ-kernels on the same two reference platforms, as the paper proposes.
- Whether a kernel compiler (as in Spin) can be integrated with a pure µ-kernel design, for instance to eliminate nested IPC redirection (clans).
- Measuring complete systems built on these primitives, not only primitives.
- Redesigning address-space switching and IPC for processors with larger or tagged TLBs.

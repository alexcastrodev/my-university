---
title: "Exokernel: An Operating System Architecture for Application-Level Resource Management"
summary: Engler, Kaashoek and O'Toole argue that a kernel should only protect hardware resources, not manage them, and build the Aegis exokernel and the ExOS library operating system on MIPS DECstations to show that virtual memory, IPC and scheduling can live in untrusted application-level libraries at much lower cost than in Ultrix.
researchArea: Operating Systems
keywords: exokernel, library operating system, secure binding, visible revocation, protection versus management, application-level resource management, Aegis, ExOS
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Traditional operating systems limit the performance, flexibility, and functionality of applications by fixing the interface and implementation of operating system abstractions such as interprocess communication and virtual memory. The exokernel operating system architecture addresses this problem by providing application-level management of physical resources. In the exokernel architecture, a small kernel securely exports all hardware resources through a low-level interface to untrusted library operating systems. Library operating systems use this interface to implement system objects and policies. This separation of resource protection from management allows application-specific customization of traditional operating system abstractions by extending, specializing, or even replacing libraries.

We have implemented a prototype exokernel operating system. Measurements show that most primitive kernel operations (such as exception handling and protected control transfer) are ten to 100 times faster than in Ultrix, a mature monolithic UNIX operating system. In addition, we demonstrate that an exokernel allows applications to control machine resources in ways not possible in traditional operating systems. For instance, virtual memory and interprocess communication abstractions are implemented entirely within an application-level library. Measurements show that application-level virtual memory and interprocess communication primitives are five to 40 times faster than Ultrix's kernel primitives. Compared to state-of-the-art implementations from the literature, the prototype exokernel system is at least five times faster on operations such as exception dispatching and interprocess communication.

## Overview

This is the paper from the MIT Laboratory for Computer Science that gave the exokernel its name, presented at SOSP '95 (Copper Mountain, Colorado, December 1995). It sits in a long line of papers about where the line between operating system and application should be drawn: [The UNIX Time-Sharing System](/papers/unix-time-sharing-system) fixed a small set of high-level abstractions (files, processes, pipes) that every program uses, and [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems) supplied the vocabulary of protection (capabilities, descriptors, least privilege) that secure bindings draw on, though this paper does not cite it as its source. The authors also invoke the end-to-end argument, a line of thought shared with [Hints for Computer System Design](/papers/hints-for-computer-system-design): the application knows better than the OS what its resource-management goal is.

The thesis is that the operating system abstractions (virtual memory, IPC, files, processes) are overly general, hurt applications that need something else, and cannot be changed by untrusted code, whether they live in the kernel or in trusted user-level servers as in microkernels. The remedy is to move them into libraries linked into each application.

Worth knowing first: what a TLB is and how a software-managed TLB refill works on MIPS, what a system call and a protection domain are, and what a monolithic kernel and a microkernel are.

## Contribution

- **Separate protection from management.** The exokernel only tracks ownership, guards each use or binding point, and revokes access. Policy, such as which page to evict, is decided by the library operating system. Resources are exported as the hardware presents them (physical pages, TLB entries, time slices, packet filters), not emulated.
- **Secure bindings.** Authorization is done once, at bind time, and later accesses are checked by simple operations. The paper implements them in three ways: hardware mechanisms (a TLB entry, memory capabilities), software caching (a software TLB), and downloaded code (packet filters and application-specific safe handlers).
- **Visible resource revocation.** The kernel tells a library OS when a resource is taken back, so the library can choose which instance to give up and update its own physical names.
- **An abort protocol.** If a library OS does not answer revocation quickly, the kernel breaks the bindings by force and records it in a repossession vector, instead of killing the application.
- **Design principles.** Expose hardware, allocation, names and revocation; avoid resource management beyond what protection needs.
- **Two systems.** Aegis is the exokernel and ExOS is a library OS. Both run on MIPS-based DECstations (R2000 and R3000).

## Methodology

The paper is a design and a prototype, evaluated against four hypotheses: exokernels can be very efficient, low-level secure multiplexing can be efficient, traditional abstractions can be implemented efficiently at application level, and applications can build special-purpose versions of them. Measurements run on three DECstations (DEC2100, DEC3100 and DEC5000/125) against Ultrix 4.2 on the same hardware. Each operation is repeated many times and averaged, so the numbers do not include cold cache or TLB misses; the authors say this favors Ultrix, which has a bigger footprint. For Ultrix they took the best time over machine instances, and for the exokernel the median of three trials.

Comparisons with the literature (L3, Thekkath and Levy's exception work, FRPC, the PATHFINDER and MPF packet filters) use published numbers on other machines, scaled by SPECint ratings or instruction counts, which the authors call crude. The text is also upfront that Aegis and ExOS do not offer the same functionality as Ultrix.

## Findings

All figures below are from the paper, on the DEC5000/125 unless stated.

- **Primitives.** A system call is 1.6 to 2.3 microseconds on Aegis against 21.3 for Ultrix getpid. Exception dispatch takes 1.5 microseconds (18 instructions) against 130 to 154 on Ultrix, and the paper says over five times faster than the best published number (8 microseconds on a DECstation 5000/200). A one-way protected control transfer takes 1.4 microseconds (30 instructions), which the authors compare with a scaled 9.3 for L3, 6.6 times faster.
- **IPC in a library.** ExOS pipes take 14.2 microseconds (10.7 when inlined) against 199 on Ultrix, shared-memory ping-pong 5.7 against 118, and a local RPC (lrpc) 6.3. A trusted variant (tlrpc) that skips saving registers cuts it to 2.9.
- **Virtual memory in a library.** ExOS handles a page-protection trap in 4.8 microseconds against 161, and the Appel and Li benchmarks appel1 and appel2 are 34 and 22 against 262 and 232 (per page). Ultrix is faster at protecting 100 contiguous pages (up to about 1.6 times in the paper's tables). A 150 by 150 matrix multiply runs in about the same time on both.
- **Network.** The compiled packet filter (DPF) classifies a TCP/IP header in 1.5 microseconds against 35.0 for MPF and 19.0 for PATHFINDER. Round-trip latency of a 60-byte packet is 259 microseconds with ASHs, 320 without, 3400 on Ultrix, and 340 for FRPC on a slightly faster machine.
- **Customization.** An ExOS with inverted page tables is over twice as fast on dirty, 37% on appel1 and 17% on appel2. A stride scheduler under 100 lines kept a 3:2:1 allocation close to the ideal.

What the paper does not claim: that exokernels are secure against malicious libraries in general, that a full POSIX system or file system has been measured (ExOS has no swapping, and the file system is still under development), or that the abort protocol has been measured. It says the prototype had no real users.

## Critical Analysis

The central idea (protection and management are different jobs) is stated clearly and the measurements back the claim that fixed abstractions cost something. Several limits are worth keeping in mind.

- **Small, favorable benchmarks.** Microbenchmarks repeated in a loop show best-case costs, and the abstractions compared are narrower than Ultrix's. The authors flag both points, but the 10 to 100 times figures are for primitives, not applications.
- **Scaled comparisons.** The speedups over L3 and others rely on scaling published numbers across different processors and are called crude by the paper.
- **Design for 1995 hardware.** Software-loaded TLBs, tagged frame buffers and packet filters made secure binding easy on MIPS. The paper says the details depend on the address translation hardware and discusses page-table hardware only in outline.
- **Who writes the library?** The architecture expects most programs to use a few standard library OSes. Compatibility and sharing between mutually distrustful libraries (a shared file system, a buffer cache) get little measured treatment.

Later literature, not part of this paper and not read for this analysis (bibliographic data from Crossref): Liedtke's "On micro-kernel construction" and the SPIN paper (Bershad et al.) appeared in the same SOSP '95 proceedings, and the authors' own follow-up, "Application performance and flexibility on exokernel systems" (SOSP 1997), extends the evaluation. "The multikernel: a new OS architecture for scalable multicore systems" (SOSP 2009) and "Unikernels: library operating systems for the cloud" (ASPLOS 2013) are later OS-structure work that the reader may want to compare. Within this catalog, the same question of separating policy from a thin kernel appears in [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space), [Snap](/papers/snap-microkernel-approach-to-host-networking), the [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) and [KFlex](/papers/fast-flexible-practical-kernel-extensions). These pairings are mine; the 1995 paper cannot cite them.

## Further Research

- How to apply secure bindings to hardware that does not offer software TLBs or per-resource ownership tags.
- Library operating systems that remain portable across hardware and that coexist with shared services such as a file system.
- The cost and behavior of the abort protocol under real contention.
- Making downloaded code (filters, handlers) safe and cheap without trusted servers.
- Whether application-level management beats well-tuned general-purpose kernels on whole applications, not just primitives.

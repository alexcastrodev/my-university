---
title: "Hyperkernel: Push-Button Verification of an OS Kernel"
summary: Nelson and colleagues redesign the xv6 kernel interface so that every system call is finite, and then verify 50 trap handlers with the Z3 SMT solver against a state-machine specification and a declarative one, with no hand-written proof scripts. Verification takes about 15 minutes on 8 cores, and the paper lists what stays outside it (initialization, glue code, the compiler backend, multicore).
researchArea: Operating Systems
keywords: Hyperkernel, push-button verification, SMT solver, Z3, finite interfaces, LLVM IR, xv6, refinement, hardware virtualization
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This paper describes an approach to designing, implementing, and formally verifying the functional correctness of an OS kernel, named Hyperkernel, with a high degree of proof automation and low proof burden. We base the design of Hyperkernel's interface on xv6, a Unix-like teaching operating system. Hyperkernel introduces three key ideas to achieve proof automation: it finitizes the kernel interface to avoid unbounded loops or recursion; it separates kernel and user address spaces to simplify reasoning about virtual memory; and it performs verification at the LLVM intermediate representation level to avoid modeling complicated C semantics. We have verified the implementation of Hyperkernel with the Z3 SMT solver, checking a total of 50 system calls and other trap handlers. Experience shows that Hyperkernel can avoid bugs similar to those found in xv6, and that the verification of Hyperkernel can be achieved with a low proof burden.

## Overview

Verifying a kernel removes whole classes of bugs, but the paper opens with the price: the functional correctness proof of [seL4](/papers/sel4-formal-verification-of-an-os-kernel) took roughly 11 person-years for 10,000 lines of C, written by hand in an interactive prover. This SOSP 2017 paper from the University of Washington asks what happens if the kernel is designed so that an SMT solver can do the proof alone.

The answer leans on older OS ideas. The interface resembles an [exokernel](/papers/exokernel-os-architecture-application-level-resource-management): user space chooses which page or file descriptor to use and the kernel only checks that it is free. Processes run as guests under hardware virtualization, as in Dune, the base of [IX](/papers/ix-protected-dataplane-operating-system). Later kernels in the catalog that prove code at scale, [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) and the memory manager of [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness), use Verus and Rust instead.

Worth knowing first: SMT solving (bit-vectors and uninterpreted functions), refinement between a specification state machine and an implementation, and LLVM IR as a compiler intermediate form.

## Contribution

- **A push-button approach.** Two Python specifications and a C implementation are all the programmer writes per system call; the verifier turns them into SMT queries and Z3 either proves them or returns a counterexample that becomes a test case.
- **Finite interfaces.** Every trap handler must be expressible as traces of bounded length, independent of parameters such as the number of file descriptors. POSIX dup becomes dup(oldfd, newfd), so the kernel checks a slot instead of searching for the lowest free one. The paper says that applying the approach to an existing kernel "is unlikely to scale".
- **Separate address spaces.** With Intel VT-x and AMD-V, the kernel runs as host with an identity mapping and processes run as guests with their own page tables, so kernel code needs no virtual-to-physical reasoning.
- **Verification on LLVM IR,** which has simpler semantics than C and fewer undefined behaviors, and is higher level than x86 assembly.
- **Two specifications.** A state-machine specification of each trap handler, plus a declarative specification of crosscutting properties that the first one must satisfy.

## Methodology

The kernel is modeled as a state machine; each trap handler runs atomically with interrupts disabled on a uniprocessor. Theorem 1 (refinement) says the implementation refines the state-machine specification: assuming equivalent states (through a programmer-written equivalence function) and a representation invariant, both move to equivalent states and the invariant holds again. The verifier gets the implementation side by exhaustive symbolic execution of the LLVM IR, which unrolls loops (self-finitization) and emits checks against undefined behavior. Theorem 2 (crosscutting) says the state-machine specification preserves the declarative predicate P.

Quantifiers are kept out of the SMT encoding except in the declarative specification. Exclusive ownership is written with an inverse function, and reference counts with a permutation, because naive encodings can make the solver fail to terminate. Volatile reads (DMA and device pages) return fresh symbolic values. The state-machine and declarative specifications are Python on top of the Z3 API; the verifier itself is C++ and Python.

The authors also compare against the xv6 commit log (January 2016 to July 2017), time verification across monthly Z3 commits, raise the page limit 2x, 4x and 100x, and run benchmarks adapted from Dune against Linux 4.8.0.

## Findings

- **Size (Figure 8).** Kernel implementation 7,419 lines (C and assembly), representation invariant 197, state-machine specification 804, declarative specification 263, user-space code 10,025, verifier 2,878. The kernel has 50 trap handlers.
- **Verification time.** About 15 minutes on an eight-core Core i7-7700K with Z3 4.5.0; on one core about 45 minutes (12 for Theorem 1, 33 for Theorem 2). Every monthly Z3 commit since January 2016 proved it, and raising the maximum number of pages 2x, 4x and 100x did not noticeably increase the time.
- **Effort.** Several researchers, about a year, mostly spent on trying designs: a Rust kernel (dropped because of ownership and the cost of formalizing Rust), then a C kernel with the classic address layout, then Hyperkernel. Once the libraries existed, one author could verify a new system call in an hour.
- **Properties proved.** Among them: a process's page table root is exclusively owned by it (Property 3); a writable page-table entry points to a page owned by the same process (Property 4); and any writable page reached by a four-level walk is owned by the process and is a page frame (Property 5). Reference counts match the objects that refer to them, and no process designates a free process as its parent (Property 2).
- **Bugs.** Of ten xv6 bugs fixed in that period, two (locking) do not apply; of the other eight, five cannot occur in Hyperkernel and three (in ELF loading) can occur but only in user space. The declarative specification exposed three bugs in the state-machine specification: a file-table slot check done two inconsistent ways, and two IOMMU lifetime bugs.
- **Run time (cycles, Linux, Hyperkernel, Hyp-Linux).** syscall 125, 490, 136; fault 2,917, 615, 722; appel1 637,562, 459,522, 519,235; appel2 623,062, 452,611, 482,596. A hypercall round trip costs 497 cycles against 69 for a syscall on the i7-7700K.

## Critical Analysis

The paper is candid about what is outside the theorems. Not covered: kernel initialization and glue code (for example the assembly that saves and restores registers), and the final binary. The verifier works on LLVM IR, so undefined behavior in the C that does not show up in the IR is missed, and the LLVM backend is trusted. The C frontend and IR optimizer are not. The trusted base also includes the specifications, the equivalence function, the verifier, Z3, Python, the inline assembly model for TLB flushes, and the hardware (CPU, memory, IOMMU). DMA is handled by confining devices to dedicated pages (VT-d and DEV configured at boot) and treating those reads as arbitrary, not by modeling devices. Three checkers cover part of the gap: boot (the invariant holds at start), stack (all handlers fit in the 4 KiB stack) and link (symbols do not overlap).

The paper does not prove the free page list is complete or that the scheduler avoids starvation, and it has no multicore, threads, copy-on-write fork or permissions. The file system and network stack run unverified in user space. Fork, exec and mmap are non-finite, so they live in user libraries. The request behind this note described a code subset "without pointers"; the paper does not say that. It says kernel data is mostly arrays and that goto and fall-through switch are allowed. "Low proof burden" is not given as a ratio: the figures above show 1,264 lines of specification and invariant (my sum) against 7,419 of kernel, and no person-year cost for the proof itself.

Literature after the paper, known to me only by Crossref metadata and not read: Serval (Nelson, Bornholt, Gu, Baumann, Torlak, Wang, SOSP 2019, "Scaling symbolic evaluation for automated verification of systems code with Serval"), whose title suggests a reusable framework for the verifier used here. For concurrency, the other side of this paper's uniprocessor choice, see [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs), which finds memory-ordering bugs in Linux and is not a verification result.

## Further Research

- Multicore support: the authors say verifying it is beyond this paper and that automated reasoning for concurrent kernels is promising.
- Finite-interface designs for threads, copy-on-write fork, shared pages and permissions.
- Verified file systems and high-performance network stacks for the user-space servers.
- Linked data structures, using recent automated verification work, to prove the free list and scheduler.
- Porting to ARM, where system call and hypercall costs are similar, and encodings that work for non-finite interfaces such as seL4 capability revocation.

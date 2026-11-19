---
title: "CertiKOS: An Extensible Architecture for Building Certified Concurrent OS Kernels"
summary: CertiKOS builds a multicore kernel out of certified abstraction layers and proves in Coq that every kernel function contextually refines its specification under any interleaving, giving mC2, a 6,500-line kernel with fine-grained locking verified in under 2 person-years of concurrency work.
researchArea: Operating Systems
keywords: certified kernels, contextual refinement, certified abstraction layers, concurrent verification, environment context, Coq, CompCertX, starvation-freedom
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Complete formal verification of a non-trivial concurrent OS kernel is widely considered a grand challenge. We present a novel compositional approach for building certified concurrent OS kernels. Concurrency allows interleaved execution of kernel/user modules across different layers of abstraction. Each such layer can have a different set of observable events. We insist on formally specifying these layers and their observable events, and then verifying each kernel module at its proper abstraction level. To support certified linking with other CPUs or threads, we prove a strong contextual refinement property for every kernel function, which states that the implementation of each such function will behave like its specification under any kernel/user context with any valid interleaving. We have successfully developed a practical concurrent OS kernel and verified its (contextual) functional correctness in Coq. Our certified kernel is written in 6500 lines of C and x86 assembly and runs on stock x86 multicore machines. To our knowledge, this is the first proof of functional correctness of a complete, general-purpose concurrent OS kernel with fine-grained locking.

## Overview

[seL4](/papers/sel4-formal-verification-of-an-os-kernel) showed in 2009 that a whole microkernel can be proved correct, but for a single core. This OSDI 2016 paper from Yale asks the next question: what if the kernel runs on several CPUs at once, with fine-grained spinlocks, thread yield, sleep and wakeup, and interrupts? The authors cite researchers who believed the combination of concurrency and functional complexity makes verification intractable, or far costlier than the sequential case. Existing verified kernels, file systems and drivers did not address shared-memory concurrency; the paper reviews seL4 (single big kernel lock, argued enough for a microkernel by Peters et al. and von Tessin), Hyper-V under VCC (about 20% of the code verified, contracts and type invariants only) and a preemptive single-core effort on uC/OS-II.

The kernel they build and verify is called mC2 (the earlier sequential kernel is mCertiKOS). It also doubles as a hypervisor and was developed in a DARPA project, running three Ubuntu guests on an unmanned ground vehicle with a Core i7.

Worth knowing first: refinement (an implementation behaves like its specification), linearizability, starvation-freedom (every request is eventually served) and the Coq proof assistant.

## Contribution

- **Certified abstraction layers.** A layer is a triple (L1, M, L2) plus a machine-checked proof that module M, running over underlay L1, contextually refines overlay L2. The deep specification L2 captures everything observable about M, so M never needs to be read again.
- **Environment contexts.** Each layer is parameterized by a set of active threads or CPUs, and the rest of the system is a function that answers with the events other CPUs would generate. Parallel composition is [[P]]L(A∪B) = [[P]]L(A) ∩ [[P]]L(B) for disjoint A and B, so per-CPU proofs can be composed under compatible rely conditions.
- **Sequential techniques for concurrent code.** Kernel code is written in ClightX, verified at source level and compiled by CompCertX, a thread-safe CompCert. Concurrent primitives are treated as external calls the compiler cannot reorder.
- **Progress, not only safety.** Temporal invariants on the environment (fair scheduling, bounded lock hold times) prove starvation-freedom of ticket and MCS locks and of condition variables.
- **A working kernel.** mC2, with locks, queues, scheduler, physical and virtual memory, containers with quotas, shared-memory IPC, synchronous IPC, virtualization and drivers.

## Methodology

The proof is a chain of Coq simulations, each one a CompCert-style upward-forward simulation (Figure 5). The multicore model with arbitrary instruction interleaving refines a model with a hardware scheduler (Lemma 1), then a model where each CPU holds a local copy of shared memory moved by logical `pull` and `push` primitives (Lemma 2), then a partial machine with an active CPU set (Lemmas 3 and 4), and finally a CPU-local model whose switch points sit only before atomic or push/pull operations (Lemma 5). A program that races goes wrong in the local-copy model, so safety there gives data-race freedom. Atomic objects keep a logical log of events and recover their state by replaying it. Locks are layered so that a lock defined at a lower layer cannot be taken above it, which the paper says prevents deadlocks.

## Findings

- **What is proved.** Contextual refinement of mC2 against a high-level deep specification, which the authors say implies that all system calls and traps follow the specification, run safely and terminate, with no data race, code injection, buffer overflow, null pointer access or integer overflow. Behaviors proved about user program P over the specification transfer to the linked system on x86.
- **Isolation and liveness.** Page-map invariants (kernel pages kernel-only, non-shared user memory isolated), per-thread page quotas that block memory-exhaustion denial of service, and starvation-freedom of ticket and MCS locks (at most n x m x k loop iterations). The paper states no noninterference theorem for mC2 itself and points to separate work on information-flow security.
- **Effort.** About 2 person-years for the concurrency framework and features. 943 lines specify the hardware model and 450 the system call interface (the trusted base). Outside it: 5,249 lines of kernel specifications, about 40K of definitions, lemmas and invariants, and 50K of Coq proof scripts for the concurrency additions. At least a third is redundant and semi-automatically generated.
- **Bugs.** A ticket-lock loop written `now<t` passed all tests but failed the specification when the ticket overflows at 2^32 - 1, and it was fixed with `now!=t`. The FIFOBBQ in a popular OS textbook can get stuck, and the authors fixed it.
- **Performance.** On a 2.8 GHz Core i7-2600S, an uncontended lock costs 34 cycles (ticket) and 74 (MCS). With server/client pairs, fine-grained mC2 reaches 1.77x to 1.84x speedup on 2 cores and 2.62x to 2.71x on 3, against 1.45x to 1.66x and 1.64x to 2.07x for a big-kernel-lock variant. Round-trip IPC takes about 3,800 cycles, against about 1,200 (fastpath) and 1,800 (slowpath) for an unverified single-core seL4. As a hypervisor, overhead is moderate and comparable to KVM, worse on file-heavy runs such as unpacking Linux and Tomcat.

## Critical Analysis

The authors state their limits plainly. Atomic instructions assume sequential consistency; they believe the proof holds for x86 TSO but say more formalization is needed. The machine has no TLB, so TLB shootdown cannot be verified, and only a small part of the x86 instruction set is covered. The CompCertX assembler, the Coq checker and code extraction are trusted. The bootloader, the PreInit module and the ELF loader are not verified, and there is no certified storage system. Power management code is unverified, so turbo boost was disabled in experiments.

The following points are a reading of the evidence, not claims of the paper.

- **The IPC comparison is uneven.** The paper itself says the seL4 IPC semantics differ, and uses unverified single-core seL4 numbers, a 158-cycle Null cost from the seL4 team, and a constructed (Call + ReplyWait) + Null x 2 sum. The gap is about 2x to 3x on the metric a microkernel cares most about; the authors attribute it to seL4's heavy, hardware-specific IPC tuning and give no breakdown.
- **The formal theory is elsewhere.** The definitions of environment contexts and the discharge of the fairness assumptions are in a separate technical report, so this paper alone cannot be checked on them.
- **Scaling is shown only to 3 of 4 cores.** The cause is attributed to system processes and unaligned data, not measured.
- **Proof size.** Adding the paper's figures gives about 95K lines outside the trusted base plus 1,393 inside it, roughly 14.9 lines per line of code (my arithmetic). The Atmosphere note in this catalog cites the same 14.9:1 ratio for CertiKOS (see [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus)); that is later literature, and I did not read the Atmosphere paper itself, only that catalog note. It adds that comparing ratios across tools is rough.
- **Later work, not read.** Crossref lists "Certified concurrent abstraction layers" (PLDI 2018) by an overlapping author list; I checked only title, authors and venue, and did not read it.

## Further Research

- Formalizing the TSO model, so the sequential-consistency assumption can be dropped. Weak-memory bugs are the target of testing work such as [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs).
- Modeling the TLB and verifying the boot path, loaders and assembler. Another verification of concurrent memory management is [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness), which uses a different verifier.
- A certified file system, which the authors plan to add from recent work.
- A layer calculus that removes the redundant definitions and proofs, which the authors say they are developing. [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) goes the other way, with SMT-based automation and no multicore support, so cost and concurrency have not yet been combined in the catalog's papers (my reading).

---
title: "Atmosphere: Practical Verified Kernels with Rust and Verus"
summary: Atmosphere is a microkernel written in Rust and proven functionally correct with the Verus verifier. It keeps proofs cheap by using raw pointers, permissions stored in flat maps and manual memory management, and it proves noninterference between isolated containers.
researchArea: Operating Systems
keywords: verified microkernel, verus, rust, flat permissions, noninterference, manual memory management, proof-to-code ratio
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Formally verified kernels have stayed rare because proving them was expensive. The authors recall that seL4 needed 11 person-years for the proofs plus 9 more for supporting frameworks and tools, and that push-button verifiers such as Hyperkernel bought automation by restricting the kernel interface (every path must be finite, so the file open call makes the user pick the descriptor number). Meanwhile the practicality of verifying feature-rich, pointer-heavy system code is, in the authors' words, still an open debate.

This SOSP 2025 paper (Seoul), from the University of Utah (Vikram Narayanan now lists Palo Alto Networks, and the work was done at Utah), asks whether Verus, an SMT-based verifier for Rust, can verify a full microkernel at modest cost. Atmosphere is the answer: processes, threads, dynamic memory, endpoint-based IPC, virtual address spaces, IOMMU support and containers, all in Rust, with drivers and network stacks running in userspace.

Key terms: refinement means the implementation matches a high-level abstract specification of the kernel. Well-formedness means the invariants of every data structure hold after each system call. A tracked permission is a linear ghost token that Verus requires before a raw pointer may be used. A container is a group of processes with a guaranteed memory quota and set of CPU cores. Noninterference means one container's system calls cannot change another's observable state.

Worth knowing first: Rust ownership and borrowing, pre and postconditions, and how an SMT solver handles quantified formulas. [RustBelt](/papers/rustbelt-securing-foundations-of-rust) is the formal account of why Rust's ownership discipline can be trusted, and the paper cites it, together with Viper and Prusti, as prior work on permission-based reasoning.

## Contribution

- **A verified microkernel built mostly from ordinary kernel parts.** It runs on multi-CPU hardware under one global big lock, with interrupts disabled inside the kernel. The authors report 6K lines of executable code and 20.1K lines of proof code: 14.3K of specifications (2.9K of them the top-level specification of the system call interface) and 5.8K of hints and proofs.
- **Pointer-centric design.** Kernel structures use raw, non-linear pointers as unsafe C would, including reverse pointers from children to parents, internal list and tree storage and constant-time removal from linked lists. Verus checks every pointer operation through its permissioned pointer type `PPtr<T>` and the ghost permission `PointsTo<T>`.
- **Flat permission storage.** The permissions to all nodes of a recursive structure live in one map at the top of the subsystem, for example the process manager holds maps of all containers, processes, threads and endpoints. Properties of an unbounded tree can then be stated without recursion. The container path invariant, normally a recursive parent-child definition, becomes one statement over all nodes, and a ghost `subtree` set per container gives direct access to all descendants.
- **Separating structural from non-structural proofs.** Structural invariants (the tree has no cycles, reverse pointers are right) sit in closed specification functions, which cost nothing outside their module. A system call such as `new_container` states only how the state changes, and a separate proof function shows that the change preserves the structural invariant.
- **Manual memory management.** Atmosphere does not rely on Rust's borrow checker or smart pointers for kernel object lifetimes. Objects take 4KB, 2MB or 1GB pages from an allocator whose state is exposed to the specifications, and each object has a `page_closure()`. The authors prove local disjointness and merge the closures bottom-up, which gives memory safety and leak freedom without a global pairwise proof.
- **Containers and noninterference.** Containers form a tree, and the only way to revoke a container's resources is to terminate it, a deliberate loss of fine-grained revocation that simplifies reasoning about user code. For two untrusted containers A and B and a verified shared container V, the authors prove memory isolation and endpoint isolation across arbitrary system calls, then derive noninterference from three unwinding conditions: output consistency, step consistency and local respect.

## Methodology

The kernel is modeled as a state machine over an abstract state. Two theorems are proven: refinement of the abstract specification, and well-formedness of a hierarchy of invariants after every transition. Specifications and proofs are ghost code, erased at compile time, so verification adds no runtime cost.

The evaluation asks whether verified development is practical and whether the kernel gives up performance. Verification time is measured on a CloudLab c220g5 server (two 10-core Xeon Silver 4114, 192 GB) and on a laptop with an i9-13900HX. Network tests use c220g2 machines with 10Gb NICs, NVMe tests use d430 machines, all running Ubuntu 20.04 with a 5.4.0 kernel, and hyper-threading, turbo boost, idle states and frequency scaling are disabled. Comparisons are NrOS's Verus page table, Mimalloc and VeriSMo for proof effort, seL4 for system calls under KVM, and Linux, DPDK, SPDK, fio and Nginx for drivers and applications. The authors wrote an Ixgbe network driver and an NVMe driver, plus Maglev, a key-value store and a small web server on top.

## Findings

These are the authors' reported results.

- **Proof effort.** Atmosphere has a proof-to-code ratio of 3.32:1 (Table 2 lists 20,098 lines of proof for 6,048 of code), against 20:1 for seL4 and 14.9:1 for CertiKOS. VeriSMo is lower at 2:1, which the authors attribute to simpler semantics and a relaxed verification timeout that trades speed for fewer proof lines.
- **Verification time.** On the c220g5 server full verification takes 3m29s on one thread and 1m7s on eight, against 12m11s for VeriSMo and 1m40s for Mimalloc on eight threads. On the laptop it takes under 20 seconds with 32 threads and 47 seconds with one.
- **Flat design pays off in one head-to-head.** For comparable page tables, Atmosphere's has a ratio of 4.3:1 against 13.3:1 for NrOS (the text says 4.4:1) and verifies in 33 seconds on one thread against 1m52s. NrOS needs about 200 lines of proof to unroll its recursive specifications in one function, while Atmosphere needs about 30 lines to show other entries do not change.
- **Development effort.** Three successive versions took about 2 person-years in total, with roughly 14 months on verified code: 2 months for one person, 8 months for two, and 4 months for one who reused half the previous code.
- **IPC and memory calls.** Under KVM, call and reply takes about 1,058 cycles against 1,026 for seL4, and mapping a page takes about 1,984 against 2,650, though the authors note the calls are not strictly equivalent.
- **Network driver.** With batches of 32 packets both Atmosphere and DPDK reach the 10GbE line rate of 14.2 Mpps, while Linux gets 0.89 Mpps. With the application in a separate process on the same core, Atmosphere reaches 2.3 Mpps per core with one context switch per packet and 11.1 Mpps with batches of 32.
- **NVMe driver.** It performs like SPDK on sequential reads and reaches the device maximum. On writes with batch 32 it reaches 232K IOPS, a 10% overhead against a device maximum near 256K IOPS, which Linux with fio approaches within 3%. On reads fio reaches 13K and 141K IOPS per core for batches of 1 and 32.
- **Applications.** Maglev reaches 1.0 Mpps per core on Linux sockets and 9.72 Mpps per core with DPDK. On Atmosphere it reaches 13.3 Mpps with the driver on a separate core, 8.8 Mpps on one core with batches of 32, and 1.66 Mpps with batches of 1. The web server serves 99.4K requests per second linked to the driver, against 70.9K for Nginx on Linux.

## Critical Analysis

The paper is open about several limits. The proofs cover system calls only, not user code, and timing channels through shared caches and other hardware are out of scope. Long-running calls (mapping or sending large regions, terminating containers) hold the big lock for a long time and can leak timing, a limit the authors would remove by bounding region sizes and making kill iterative as seL4 does. The shared container V has one process and one thread, and proofs for concurrent shared drivers are left as future work. The trusted computing base is listed in full: Verus, Z3, the Rust compiler and core library, specifications of core types, about 700 lines of missing axioms, about 300 lines of setter functions with 1,900 lines of specifications (Verus lacks mutable references to tracked permissions), 172 lines of assembly, roughly 3,000 lines of trusted Rust, the boot loader and the hardware.

The following points are a reading of the evidence, not claims of the paper.

- **The effort figures disagree.** The abstract and introduction say less than 2.5 person-years, 1.5 of them on verification, while Section 6.3 says around 2 person-years with roughly 14 months on verified code. The three stages listed add up to about 22 person-months. I use the Section 6.3 figure.
- **The laptop number hides its thread count.** "Under 20 seconds on a modern laptop" is with 32 threads. On one thread it is 47 seconds, and on the server it is 1m7s with eight. The claim that this beats compiling the kernel is not backed by a measurement.
- **Proof-to-code ratios compare unlike things.** They cross Isabelle, Coq, Dafny and Verus, a big lock against CertiKOS's fine-grained concurrency, and different scopes. The VeriSMo discussion shows the ratio can be traded against verification time, so it is a rough guide.
- **The flat design is tested on one subsystem.** The NrOS page table is the only head-to-head. The container tree, where the paper argues flatness matters most, has no hierarchical variant to compare with, and no ablation isolates each design choice.
- **Performance baselines differ in features.** seL4 provides capabilities and fine-grained revocation that Atmosphere omits, so 1,058 against 1,026 cycles compares different jobs. The Linux, Nginx and Maglev gaps mostly show kernel bypass, which DPDK also gives, and the 13.3 Mpps result uses two cores while the DPDK figure is per core. The kernel is tested at one or two cores, so contention on the big lock is not measured. The key-value store results are only in a chart, with no stated numbers.
- **The top-level specification carries the trust.** Refinement holds against 2.9K lines of system call specification, and the text does not say how those were checked against intended behavior. It reports no bugs found by verification, though it says testing needed far less effort, with no numbers.
- **The trusted base sits on the isolation path.** About 3,000 lines of trusted Rust sit beside 6K lines of verified code, and 465 lines configuring the IOMMU are among them, even though IOMMU page tables are part of the verified memory subsystem. Device isolation depends on both.
- **Noninterference is shown for one configuration.** The authors argue other setups are similar or simpler, but demonstrate only A, B and V.

## Further Research

- Proofs of concurrent shared services such as I/O-intensive drivers, which the authors expect to be feasible because modern drivers separate control and data planes.
- Bounded and iterative long-running system calls, which would close the timing leak and could open the way to measuring or replacing the big lock.
- Shrinking the trusted base: verifying the roughly 700 lines of axioms, replacing setter functions as Verus gains mutable references for tracked permissions, and covering the IOMMU and interrupt setup code.
- A controlled study of flat versus hierarchical permissions on a larger structure such as the container tree, plus a record of bugs found by proof, to test the cost claims beyond one page table.

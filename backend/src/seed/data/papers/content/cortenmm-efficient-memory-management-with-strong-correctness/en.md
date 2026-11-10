---
title: "CortenMM: Efficient Memory Management with Strong Correctness Guarantees"
summary: CortenMM removes the VMA tree that normally sits above the page table and programs the MMU directly through a transactional interface with two locking protocols, which scales to 384 cores and keeps the core concurrency code small enough to verify with Verus.
researchArea: Operating Systems
keywords: memory management, virtual memory, page tables, formal verification, locking protocols, rust, scalability
version: 1.0
updatedAt: 2026-11-07
---

## Overview

The memory management (MM) subsystem of an OS programs the MMU (page tables and TLBs) and must serve many threads at once. In Linux and most other systems it rests on two levels of abstraction: a software level, such as the tree of virtual memory areas (VMAs, a maple tree in current Linux), and the hardware level, the page tables. The authors trace two long-standing problems to this pairing, which dates back to SunOS in 1986. Keeping two very different structures in sync needs complex locking, which limits scalability and breeds concurrency bugs. They count ten CVEs from the per-VMA locking that Linux introduced in April 2023, nine of which can crash the system.

This SOSP 2025 paper (Seoul), from Peking University, Ant Group, CertiK, UCLA and Michigan Tech (some authors are also affiliated with Zhongguancun Laboratory), presents CortenMM, the MM of Asterinas, a Rust OS the group builds as a Linux-compatible replacement. Its bet is that mainstream ISAs (x86, ARM, RISC-V) all use multi-level radix page tables, so the software level is no longer needed.

Terms to keep straight: a PT page is one page of the page table; the covering PT page is the lowest one whose range contains the whole region being locked; an `RCursor` is the handle a transaction uses; CortenMM-rw and CortenMM-adv are the two locking protocols, one on readers-writer locks and one on lock-free traversal with RCU.

Worth knowing first: radix page tables and the Linux page fault path, what a VMA is, RCU, and two-phase locking. [RustBelt](/papers/rustbelt-securing-foundations-of-rust) is the library paper on why safe Rust rules out data races and what unsafe code must uphold. CortenMM does not cite it, but forbidding unsafe code outside its small core leans on that kind of guarantee.

## Contribution

- **One level instead of two.** Each PT page gets a page descriptor, indexed by its physical page number, holding a lock, the PT page and a per-PTE metadata array allocated on demand and freed with the PT page. The array holds what the hardware cannot: whether a page is invalid, virtually allocated, mapped or swapped, plus permissions or the swap device and offset. ISA differences are hidden with Rust traits, as Linux hides them with C macros.
- **A transactional interface.** `AddrSpace::lock(range)` returns an `RCursor` offering `query`, `map`, `mark` and `unmap`, applied atomically and released on drop. Transactions on overlapping ranges serialize and disjoint ones run in parallel. `mmap` is lock, query, mark. The page fault handler, including copy-on-write, runs entirely under one cursor.
- **Two locking protocols.** CortenMM-rw walks from the root taking reader locks, then write-locks the covering PT page. CortenMM-adv traverses without locks inside an RCU read-side critical section, spin-locks the covering PT page and then locks all its descendants by depth-first search. To unmap a PT page it clears the parent entry atomically, marks the page stale and frees it through an "RCU monitor". A thread that locks a stale page retries. Both resemble two-phase locking.
- **Verification.** Using Verus, the authors prove two properties: mutual exclusion of both protocols, and functional correctness of the four `RCursor` operations together with a well-formed page table tree. The proof is a refinement hierarchy of specifications (Atomic Spec, Atomic Tree Spec, WF Tree Spec) built on a tokenized state machine and forward simulation. Code outside this core must be safe Rust (`#![deny(unsafe_code)]`), so it cannot bypass the interface.
- **Trusted base and size.** The authors trust the hardware, Verus and its SMT solver, and the rest of the OS (physical page allocator, DMA code, lock and RCU primitives). The code is 8,028 lines of safe Rust and 122 of unsafe, and the core interface is 829 lines (225 for CortenMM-adv, 153 for CortenMM-rw). Optimizations borrowed from prior work include per-core virtual address allocators and cheaper TLB shootdowns (parallel flushes, early acknowledgement, lazy shootdown on `munmap`).

## Methodology

The machine is a two-socket AMD EPYC 9965 with 384 cores and 1TB of DRAM, hyper-threading and turbo off, run inside a virtual machine because the authors' OS (like RadixVM and NrOS) lacks drivers to boot on it directly. Baselines are Linux 6.13.8 with mitigations such as KPTI disabled, RadixVM and NrOS, and Linux and CortenMM both run an Ubuntu 22.04 userland.

Five microbenchmarks (`mmap`, `mmap-PF`, `unmap-virt`, `unmap`, `PF`) have each thread repeat an operation on a 16KB region, single-threaded or up to 384 threads, with low contention (private region) or high contention (random region of a large shared one). Real workloads are PARSEC 3.0, metis, psearchy (both from MOSBENCH), JVM thread creation on OpenJDK 21.0.6, which mimics Android app startup, and LMbench for `fork`. dedup and psearchy run with both the default allocator and tcmalloc, since modern allocators hide Linux's bottleneck by rarely returning memory. The authors also report a perf time breakdown, an ablation of the two optimizations, memory overhead on metis, verification effort and a RISC-V port.

## Findings

These are the authors' reported results.

- **Single thread.** CortenMM-adv beats Linux on four of five microbenchmarks, by 7.8% to 46.8% according to the text, and loses 3.1% on `mmap` because allocating and initializing PT pages costs more than initializing a VMA. `unmap-virt` favors it because Linux must split VMA tree nodes. `fork` is 17.7% slower, since CortenMM must walk page tables to enumerate the address space, while `fork` plus `exec` is 23.0% faster.
- **Scalability at 384 cores.** With low contention CortenMM-adv scales almost linearly and beats Linux by 33× (PF) to 2270× (`unmap-virt`). With high contention it stops scaling past 64 threads because of the last-level PT page, yet still wins by 3× (PF) to 1489× (`unmap`). CortenMM-rw wins by 5.9× (`mmap-PF`) to 275× (`unmap`) under high contention, but the text says Linux is ahead by 1.8× on PF. RadixVM beats CortenMM-adv on high-contention PF thanks to per-core page tables, at a memory cost, and NrOS stays near Linux.
- **Applications.** JVM thread creation is 32% faster than Linux for both protocols. metis is 26× faster with CortenMM-adv (15× with CortenMM-rw), and 1.24× faster than RadixVM at 128 cores, where RadixVM crashes beyond that. dedup with the default allocator gains 2.69× at 64 threads, and psearchy about 2×. With tcmalloc Linux improves but stays behind on psearchy, and the authors note that tcmalloc costs about 2× the memory there. PARSEC programs that do not stress MM show no slowdown.
- **Memory overhead.** CortenMM and Linux are similar on metis. The theoretical upper bound, with every metadata array fully populated, doubles the overhead but stays within 2%.
- **Verification effort.** Table 4 lists 4,868 lines of specifications, 4,279 of proof and 1,769 of implementation, a 5.2:1 proof-to-code ratio. It took about 8 person-months, and Verus checks it in under 20 seconds.
- **Portability.** Extra lines needed beyond x86 are 252 for RISC-V, 82 for Intel MPK and 368 for Intel TDX, against 699, 273 and 471 for Linux. In a RISC-V VM the differences to Linux resemble the x86 ones.

## Critical Analysis

The paper is open about the limits of its approach. It concedes the following.

- **Only radix page tables.** The design does not apply to MMUs that are not multi-level radix trees, and the locking exploits the page table structure. Retrofitting Linux would need it to drop such ISAs plus substantial engineering.
- **Scoped proof.** Only the code that programs the MMU is verified. Hardware, Verus, the allocators and the lock and RCU primitives are trusted, the physical page holding a page table is modeled as a linear array without a machine model, and the memory model is sequential, so ARM relaxed memory is left to techniques from VRM. The verified code is a Verus port kept apart from the kernel because the kernel needs nightly Rust, and the authors say they ensure it matches the implementation.
- **Gaps and slow paths.** There are no NUMA policies yet and no ARM port. `mmap`, `fork` and high-contention workloads are slower or stop scaling, as shown above.

The following points are a reading of the evidence, not claims of the paper.

- **"Verified" is narrower than the abstract suggests.** Properties P1 and P2 cover locking and the four `RCursor` operations. Copy-on-write decisions, swap and file-backed logic, reverse mapping and TLB shootdown sit above or beside that core, and the paper lists no property about TLB coherence.
- **The checked code is not the shipped code.** Table 4 counts 1,769 implementation lines, while the text counts 829 for the kernel core interface. Table 4 also counts components such as MM Common and Glue/Helper, which may explain part of the gap, but the paper does not reconcile the two, and equivalence is by hand rather than by tooling.
- **A cross-OS comparison inside a VM.** CortenMM runs on Asterinas and the baseline is Linux, so differences beyond MM can contribute, and the perf breakdowns show where kernel time goes per operation without isolating the MM design from the rest of the OS. The claim that a VM does not affect the results is asserted, with no bare-metal run, although nested paging changes page fault costs.
- **The headline range is a spread of cases.** The abstract says 1.2× to 26×. The body gives 32% (JVM, which is 1.32×), about 2× (psearchy), 2.69× (dedup) and 26× (metis at 384 cores). I did not find 1.2× in the text, so it may come from a chart.
- **Text and tables disagree in places.** The single-thread range of 7.8% to 46.8% sits next to figure annotations of +53.6% (PF) and +76.9% (`unmap-virt`). The text says porting to RISC-V and adding MPK each cost under 200 lines, but Table 5 shows 252 for RISC-V. I used the figures and tables.
- **Thin evidence on overhead and baselines.** Memory is measured on one workload that allocates 8MB chunks, so sparse mapping patterns are untested. RadixVM and NrOS are research prototypes compiled by the authors, RadixVM crashes past 128 cores, and NrOS lacks on-demand paging, so most evidence is against Linux alone.

## Further Research

- Linking the proven code to the compiled kernel by removing the nightly Rust dependency, which the authors are working on, so that no hand-checked match is needed.
- Extending the proofs to ARM relaxed memory, where the authors point to VRM's techniques, and to TLB coherence and the code above the core.
- NUMA policy stored in the per-PTE metadata, and an ARM port with its contiguous bit and break-before-make rule, both planned by the authors.
- Lifting the high-contention ceiling at the last-level PT page, speeding up address-space enumeration for `fork`, and testing the idea inside Linux.

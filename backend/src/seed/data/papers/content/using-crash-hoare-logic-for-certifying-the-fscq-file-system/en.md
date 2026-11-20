---
title: "Using Crash Hoare Logic for Certifying the FSCQ File System"
summary: Chen and colleagues extend Hoare logic with crash conditions, recovery procedures and logical address spaces, and use it to build FSCQ, a write-ahead-logging file system written and proved in Coq, run through FUSE at about half the speed of ext4 with data journaling.
researchArea: Operating Systems
keywords: crash safety, Crash Hoare logic, formal verification, Coq, file system, write-ahead logging, separation logic
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

FSCQ is the first file system with a machine-checkable proof (using the Coq proof assistant) that its implementation meets its specification and whose specification includes crashes. FSCQ provably avoids bugs that have plagued previous file systems, such as performing disk writes without sufficient barriers or forgetting to zero out directory blocks. If a crash happens at an inopportune time, these bugs can lead to data loss. FSCQ's theorems prove that, under any sequence of crashes followed by reboots, FSCQ will recover the file system correctly without losing data. To state FSCQ's theorems, this paper introduces the Crash Hoare logic (CHL), which extends traditional Hoare logic with a crash condition, a recovery procedure, and logical address spaces for specifying disk states at different abstraction levels. CHL also reduces the proof effort for developers through proof automation. Using CHL, we developed, specified, and proved the correctness of the FSCQ file system. Although FSCQ's design is relatively simple, experiments with FSCQ running as a user-level file system show that it is sufficient to run Unix applications with usable performance. FSCQ's specifications and proofs required significantly more work than the implementation, but the work was manageable even for a small team of a few researchers.

## Overview

A file system can work in every test and still lose data if power fails between two particular disk writes. The paper (SOSP '15, MIT CSAIL) sorts existing defenses into testing, program analysis and model checking, and says none of them can guarantee the absence of crash-safety bugs. Proof assistants had certified compilers, small kernels such as [seL4](/papers/sel4-formal-verification-of-an-os-kernel) and servers, but not code that must survive crashes. The authors note that seL4 has no persistent state, so its specification says nothing about crashes, and that [Verdi](/papers/verdi-framework-for-implementing-and-formally-verifying-distributed-systems) assumes its node-failure model is correct and leaves persistence to some file system. FSCQ targets that complementary gap.

Context in the catalog: [All File Systems Are Not Created Equal](/papers/all-file-systems-are-not-created-equal-crash-consistent-applications) is cited for application developers misunderstanding crash behavior, and the [Log-Structured File System](/papers/log-structured-file-system) supplies one benchmark. [IronFleet](/papers/ironfleet-proving-practical-distributed-systems-correct) appeared at the same conference; this paper cites the earlier Ironclad work instead.

Worth knowing first: Hoare triples {P} code {Q}, separation logic (the star operator splits a store into disjoint parts), and write-ahead logging.

## Contribution

- **Crash Hoare logic (CHL).** A specification has a precondition, a postcondition and a crash condition, which describes the disk just before a crash, so it looks like the pre- and postconditions. A recovery execution semantics (written with the operator ≫ between a procedure and its recovery procedure) says that after a crash a recovery procedure runs, maybe many times. If the recovery procedure is idempotent (its crash condition implies its precondition), CHL derives the spec with recovery from the one without.
- **Logical address spaces.** Separation logic is applied to the disk, to the logical disk a log exposes, to the inode layer, to each file's bytes and to each directory. Higher layers then reason about a simple synchronous disk and ignore the asynchronous one below.
- **Asynchronous disk model.** Each block holds a last-written value plus a set of previous values, any of which may appear after a crash. Writes are atomic per block (one 4 KB sector). `disk_sync` on an address discards the previous values, and consecutive per-address syncs are collapsed into one global sync at run time.
- **FscqLog and FSCQ.** A write-ahead log with all-or-nothing transactions, with seven proved crash states, under a file system whose layers are cache, bitmap allocator, inode, block file, directory, byte file and directory tree.
- **Proof automation.** CHL chains pre- and postconditions along the control flow, leaving mostly the representation invariants to the developer.

## Methodology

FSCQ follows the design of the xv6 file system with no multiprocessor support, and a separate bitmap for inodes. It implements the core POSIX calls (indirect blocks, nested directories, rename) with all-or-nothing atomicity and immediate durability: a call's effects are on disk when it returns. There are no hard links and no `fsync`. Open files are named by inode number, and FUSE keeps the descriptor mapping.

Coq extraction produces Haskell, plus a 400-line Haskell driver and 350 more lines for words, block operations and a cache-replacement policy. The replacement policy is validated at run time, as in CompCert, instead of proved. The benchmarks use a quad-core i7-3667U with 8 GB, Linux 3.19, an Intel SSD and GHC 7.10.2, comparing FSCQ to the xv6 file system (modified for asynchronous writes and ported to FUSE) and to ext4, all in synchronous mode (for ext4: `data=journal` and `sync`). The workloads are git clone, `make` of xv6 and of the LFS benchmark, the LFS large and small file tests, cleanup, and mailbench.

## Findings

- **Size and effort.** Figure 18 totals 31,397 lines of code and proof together, against about 3,000 lines of C for the xv6 file system. The paper gives no split between proof and code. Several researchers spent about a year and a half, mostly on proofs and specifications, and checking the proofs takes 11 hours. `Print Assumptions` shows no unproven axioms.
- **Performance.** FSCQ is close to xv6; its Haskell implementation uses about 4 times more CPU than xv6. FSCQ is about 2 times slower than ext4 with synchronous data journaling: building the xv6 source takes 3.7 s on the FSCQ and xv6 file systems and 2.2 s on ext4. FUSE adds little. In mailbench, with 10 transactions per message and about 2.8 ms per sync, a message takes 64 ms on ext4, 103 ms on xv6 and 118 ms on FSCQ. FSCQ needs four disk syncs per commit and ext4 two. Per-phase bars are in Figure 19 (a chart, not read here).
- **Crash check.** `fsstress` found no problems. Recording writes and syncs of a fixed workload, the authors built 320 crash states, recovered each, and found 10 distinct logical states, all consistent after manual inspection.
- **Bug classes.** Of eight classes the paper discusses, invariant violations, corner cases, logging mistakes, logging-API misuse and low-level errors are eliminated by the theorems. Resource-allocation bugs are partly covered (blocks are never lost, but the spec does not require running out before returning ENOSPC). Wrong error codes are open where codes are unspecified, and races are out of scope.
- **Evolution.** Asynchronous writes took about 1,000 lines in CHL and over half of FscqLog, with nothing above it changed. Indirect blocks took about 1,500 lines in the inode layer. The buffer cache took about 300 lines in FscqLog and 600 above. A log-layout change took about 50 lines of code and 100 of proof.

## Critical Analysis

The paper states several limits itself.

- **Trusted base.** Extraction adds the Haskell compiler and runtime, the driver and the Haskell FUSE library to the trusted base. The disk model assumes atomic sector writes and fail-stop crashes.
- **Scope.** One transaction at a time, no multiprocessors, no deferred durability, no extended attributes or very large files. `log_commit` may return an error if a transaction writes too much.
- **Specification gaps.** Error codes are mostly unspecified, and the paper concedes the specification or the unverified code could still be wrong, which the crash experiment below only suggests they are not.

The following points are a reading of the evidence, not claims of the paper.

- **No bug count.** The paper reports no bugs found by proving during development. Its bug argument is about categories from earlier studies, not a measured count.
- **The cost is in the benchmarks.** The paper blames the gap on syncs (four per commit against two). The ext4 baseline is `data=journal` with `sync`, not its default, and other ext4 modes reach up to about twice that throughput in some cases, so the 2 times figure depends on the chosen baseline.
- **Neighbors in the catalog.** [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) leaves its file system unverified in user space, and the [seL4](/papers/sel4-formal-verification-of-an-os-kernel) proof assumes the hardware. [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels) here is the later OSDI paper, while FSCQ cites an earlier POPL one.
- **Same group, different goal.** [Biscuit](/papers/the-benefits-and-costs-of-writing-a-posix-kernel-in-a-high-level-language), from the same MIT group, also ships a logging file system, but that paper evaluates the cost and programmability of Go, not proofs.
- **Later literature, not read.** From Crossref metadata and the USENIX page only: the same group published DFSCQ (SOSP 2017, "Verifying a high-performance crash-safe file system using a tree specification"), and Sigurbjarnarson, Bornholt, Torlak and Wang published "Push-Button Verification of File Systems via Crash Refinement" (OSDI 2016). I did not read either.

## Further Research

- Batching transactions and logging only metadata, which the authors expect to bring FSCQ closer to ext4's logging.
- Deferred durability through `fsync`, and a specification without the atomic-sector assumption.
- Multiprocessor support, which the paper calls the one change that may need global rework.
- Generating C or assembly instead of Haskell, which the paper suggests for the CPU gap to xv6.
- Verifying the full path from Coq to the running binary, including the extractor and the Haskell runtime (the paper only says other projects reached assembly).
- Placing a verified file system under the user-space servers of a verified kernel, a pairing that fits Hyperkernel, whose file system runs unverified in user space (my suggestion, not the paper's).

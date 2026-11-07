---
title: "μFork: Supporting POSIX fork Within a Single-Address-Space OS"
summary: μFork lets a single-address-space OS run unmodified multiprocess POSIX programs by copying the parent's memory to another place in the same address space, using CHERI capabilities to find and relocate pointers and to isolate the copies, and a copy-on-pointer-access scheme to keep fork cheap.
researchArea: Operating Systems
keywords: single-address-space os, fork, cheri, copy-on-pointer-access, unikernel, intra-address-space isolation, unikraft
version: 1.0
updatedAt: 2026-11-07
---

## Overview

A single-address-space OS (SASOS) puts the kernel and every application in one address space, as unikernels do. The payoff is lightweightness: cheap context switches and kernel crossings, fast IPC and a small memory footprint. The cost is that POSIX `fork` copies a process into a new address space, which a SASOS by definition does not have. Multiprocess programs therefore do not run on such systems. The authors report that 46% of the 50 most popular C repositories on GitHub and 50% of the 50 most popular Debian packages (by popcon) use `fork`, for concurrency (Nginx), privilege separation (OpenSSH, qmail), copy-on-write snapshots (Redis), fast startup (fuzzers, FaaS Zygotes) and more.

This SOSP 2025 paper (Seoul), by John Alistair Kressel and Pierre Olivier of the University of Manchester and Hugo Lefeuvre of the University of British Columbia, asks for a `fork` that is lightweight, transparent to applications, isolating between processes and at least as fast as the traditional one. The authors sort earlier attempts into four groups: segment-relative addressing in 1990s SASOSes, which modern toolchains support poorly; `vfork` plus `exec` or `spawn` only; treating the whole OS as a process and forking it in a hypervisor or host (Nephele, KylinX, Graphene); and retrofitting multiple address spaces into the SASOS (Iso-UniK). Each gives up at least one of those goals.

Four terms are worth keeping straight. A μprocess is the emulated POSIX process that μFork runs inside the single address space. An absolute memory reference is a pointer in the child's memory that still points into the parent's area after the copy. A CHERI capability is a 128-bit pointer that carries bounds and permissions, plus a hidden one-bit validity tag that the hardware clears on any illegitimate modification. CoPA, copy-on-pointer-access, is the paper's variant of copy-on-write.

Worth knowing first: how POSIX `fork` and copy-on-write work, what a unikernel is, and the idea of capability hardware. For contrast, [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) is another library-OS design that gets speed by bypassing the kernel on the I/O path. That pairing is mine, the μFork paper does not cite it.

## Contribution

- **Copy to a different place, in the same address space.** Applications are compiled as position-independent code, so most references are relative to the stack, base or program counter and survive the move. Only absolute references need relocation. At fork the kernel reserves a contiguous area for the child, copies the parent's page table entries so physical pages start shared, assigns a new PID kept where no μprocess can write, and starts a new thread. The global offset table and allocator metadata pages are copied and patched eagerly.
- **CHERI answers both hard problems.** Tags identify absolute references reliably, including in registers, where a plain integer could be mistaken for a pointer. Bounds restrict every capability to its own μprocess, and since bounds can only shrink, a μprocess cannot forge a wider one. Sealed capabilities give system calls without a trap. Because kernel and μprocesses share one privilege level (EL1), a CHERI permission bit blocks μprocess code from privileged instructions such as MSR and MRS.
- **Copy-on-pointer-access.** Plain copy-on-write breaks, because a child that only reads a page could load a stale pointer into the parent. Copy-on-access copies on any access. CoPA shares pages read-only and copies them when either side writes, or when the child loads a capability from the page, using a page-table bit that faults on capability loads. The copy remaps the child's entry to a free page, copies it, then scans it in 16-byte steps and relocates every valid-tagged reference that points outside the μprocess area or has bounds reaching outside it.
- **Parameterized isolation.** The authors name three trust levels: processes that distrust each other (qmail), a trusted program that may have bugs (Nginx), and a fully trusted one (the child of a Redis snapshot). Protection against time-of-check-to-time-of-use (TOCTTOU) attacks, which means copying user buffers into the kernel, can be dropped for the second, and isolation can be disabled entirely for the third.
- **Prototype.** μFork is a new Unikraft library, ported to CHERI on the ARM Morello board and run under the bhyve hypervisor on CheriBSD, for VirtIO networking. The authors count 7 KLoC changed, 4,230 for CHERI and bhyve support and 3,000 for μFork. Applications run without porting. Unikraft first needed per-μprocess file descriptor tables, task structs, PIDs and scheduling, and its SMP support is a big kernel lock. The code is open source.

## Methodology

All experiments run on an ARM Morello development board with 4 cores at 2.5 GHz and 16 GB of RAM. The main baseline is CheriBSD 23.11 running natively in pure-capability mode with performance options on, against μFork virtualized on bhyve, which the authors say favors CheriBSD slightly. They use no non-CHERI baseline, since the Morello stack is still immature and adds overheads. The VM-based unikernel fork Nephele only runs on x86_64, so the authors replay its microbenchmarks (fork latency, memory) on μFork and compare with numbers taken from its paper. Graphs show averages of 10 runs with standard deviation.

Three applications cover different uses of `fork`. Redis populates a database with 100 KB entries (total sizes from 100 KB to 100 MB), triggers a background save to a RAM disk and measures save time, fork latency and memory. Nginx is driven by wrk with 1 to 3 workers. A FaaS Zygote (MicroPython, the float_operation function from FunctionBench) has one thread fork as often as possible for 10 seconds on 1 to 3 cores, with a fourth core for the coordinator. Microbenchmarks add a hello-world fork, Unixbench Spawn (1,000 forks) and Context1 (a pipe between two processes, up to 100,000). An ablation compares CoPA, CoA and a full synchronous copy on Redis.

## Findings

These are the authors' reported results.

- **Fork latency and memory.** Forking a hello-world process takes 54 μs on μFork, 197 μs on CheriBSD (3.7×) and 10.7 ms on Nephele (198×), which must create a Xen domain. Per-process memory is 0.13 MB, against 0.29 MB and 1.6 MB, which is 2.2× and 12.3× less.
- **Unixbench.** 1,000 forks and exits take 56 ms on μFork and 198 ms on CheriBSD. Context1 takes 245 ms against 419 ms, which the authors credit to exception-less system calls at one privilege level.
- **Redis.** Save time is 1.8 ms against 3.4 ms at 100 KB (1.9×) and 109 ms against 158 ms at 100 MB (1.4×). Fork latency is 5× to 10× lower. At 100 MB a forked process uses 6 MB on μFork and 56 MB on CheriBSD, and the authors add that 7 MB is what Linux uses on the same board. TOCTTOU protection costs 2.6% at 100 MB.
- **CoPA ablation, 100 MB database.** A full copy moves 144 MB (136.7 MB is the static heap) and forks in 23.2 ms. CoA uses 101 MB and 283 μs. CoPA uses 6 MB and 260 μs. The authors report up to 89× lower fork latency than a full copy and up to 1.18× lower than CoA.
- **FaaS.** μFork handles 24% more functions per second than CheriBSD, and TOCTTOU protection costs almost nothing since the function makes no system calls.
- **Nginx.** Because of Unikraft's SMP limits, μFork ran on one core only. Going from 1 to 3 workers still gives it 15.6%, and against CheriBSD restricted to one core it serves 9% more requests. CheriBSD on several cores is faster. TOCTTOU protection costs 6.5% on average.

## Critical Analysis

The paper is open about several limits. It concedes the following.

- **Fragmentation.** Each μprocess needs a large contiguous area. The authors expect a 64-bit space to suffice for most multiprocess programs and leave compaction and size classes for long-running or heavily forking cases.
- **No multicore result for Nginx.** The big kernel lock kept the authors from stable multicore numbers, which they call a Unikraft problem and not one of μFork. Concurrency is shown only on up to three cores.
- **Platform caveats.** Morello is a prototype with known overheads, which the authors expect to fall to 1.8% to 3% on future hardware. CoPA needs CHERI's fault on capability load, and the authors know no other mechanism offering it, although CoA works without it. Transient-execution side channels are out of scope.
- **Engineering outside the idea.** Retrofitting per-process kernel state into a single-process SASOS can be non-negligible work, and each μprocess has a static heap whose size is fixed at build time.

The following points are a reading of the evidence, not claims of the paper.

- **"An order of magnitude" is selective.** It holds against Nephele (198× and 12.3×) and for Redis fork latency, but against CheriBSD the hello-world fork is 3.7×, Spawn about 3.5× and Context1 about 1.7× (ratios from the reported times). End to end the gains are 1.4× for Redis at 100 MB and 24% for FaaS.
- **The Nephele ratios cross platforms.** They compare Morello numbers with figures from Nephele's x86_64 paper, so they show scale more than a controlled factor. The authors explain the 6 MB against 56 MB Redis gap by CheriBSD's allocator memory consumption, and against the one Linux figure (7 MB) it is parity.
- **The full-copy baseline is shaped by the design.** Of the 144 MB, 136.7 MB is the static heap, so the 89× partly measures that choice. The CoA to CoPA gap is the cleaner result: 283 against 260 μs at 100 MB is about 1.1×, and the text does not say where 1.18× occurs.
- **Isolation is argued, not attacked.** Security rests on CHERI monotonicity and on CoPA never leaking parent capabilities. The paper reports only the cost of the checks, with no adversarial test or verification, and the privilege-separation use (OpenSSH, qmail) is not run. [Spectre](/papers/spectre-attacks-exploiting-speculative-execution) is the classic example of transient execution undermining isolation built on bounds checks, and the paper does not cite it.
- **Transparency is shown on three programs.** There is no broad compatibility run. After relocation the child's pointers differ numerically from the parent's, and the paper does not discuss programs where an address is observable, such as hash tables keyed by pointer or addresses written to a pipe.
- **Some features are described, not built.** ASLR by random base offset, shared memory and shared libraries are called straightforward, and the paper reports no implementation or measurement for them.

## Further Research

- Scaling μFork on multiple cores once Unikraft's big kernel lock is replaced, which the authors say the community is working on, to test the concurrency claim on Nginx.
- Dynamic heaps in place of the static per-μprocess heap, plus address-space compaction or size classes against fragmentation, both named by the authors.
- Other hardware: tag-based or MPK-style isolation with compiler instrumentation or shadow memory, and RISC-V CHERI parts, to see how much of CoPA survives without a pointer-load fault.
- Adversarial evaluation of μprocess isolation, a wider compatibility suite, and a study of pointer-observable programs and non-CHERI baselines.

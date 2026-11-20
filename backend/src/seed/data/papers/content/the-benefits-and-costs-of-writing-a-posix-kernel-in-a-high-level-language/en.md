---
title: "The benefits and costs of writing a POSIX kernel in a high-level language"
summary: Cutler, Kaashoek and Morris build Biscuit, a POSIX-style kernel of nearly 28 thousand lines of Go that runs NGINX and Redis, and measure what garbage collection and safety checks cost: up to 13% of kernel CPU time, with equivalent Go code paths 5% to 15% slower than C.
researchArea: Operating Systems
keywords: kernel in Go, high-level language, garbage collection, heap exhaustion, memory safety, kernel performance, Biscuit
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

This paper presents an evaluation of the use of a high-level language (HLL) with garbage collection to implement a monolithic POSIX-style kernel. The goal is to explore if it is reasonable to use an HLL instead of C for such kernels, by examining performance costs, implementation challenges, and programmability and safety benefits. The paper contributes Biscuit, a kernel written in Go that implements enough of POSIX (virtual memory, mmap, TCP/IP sockets, a logging file system, poll, etc.) to execute significant applications. Biscuit makes liberal use of Go's HLL features (closures, channels, maps, interfaces, garbage collected heap allocation), which subjectively made programming easier. The most challenging puzzle was handling the possibility of running out of kernel heap memory; Biscuit benefited from the analyzability of Go source to address this challenge. On a set of kernel-intensive benchmarks (including NGINX and Redis) the fraction of kernel CPU time Biscuit spends on HLL features (primarily garbage collection and thread stack expansion checks) ranges up to 13%. The longest single GC-related pause suffered by NGINX was 115 microseconds; the longest observed sum of GC delays to a complete NGINX client request was 600 microseconds. In experiments comparing nearly identical system call, page fault, and context switch code paths written in Go and C, the Go version was 5% to 15% slower.

## Overview

Linux, macOS and Windows kernels are written in C because it gives flexible low-level access to memory and control over allocation. The price is memory-safety bugs: the paper cites at least 50 Linux security vulnerabilities in 2017 involving buffer overflow or use-after-free in C. High-level languages with garbage collection remove those classes, but kernel designers have been skeptical that their memory management is compatible with a high-performance production kernel, and nobody had measured the cost with everything else held equal. The authors say the question of language choice, all else being equal, had not been explored.

This OSDI 2018 paper, from MIT CSAIL, answers with a working system. Biscuit keeps the design of a traditional monolithic Unix kernel, the lineage of [UNIX](/papers/unix-time-sharing-system), so that differences from Linux come as much as possible from the language. The same group had earlier shown how to remove multicore bottlenecks from Linux ([Linux scalability](/papers/analysis-of-linux-scalability-to-many-cores)); Biscuit is explicitly not tuned for many cores. The paper discusses Linux's [slab allocator](/papers/slab-allocator-object-caching-kernel-memory-allocator) and hypothesizes that Go's single general-purpose allocator and collector suffice for a wide range of kernel objects.

Worth knowing first: what a tracing garbage collector and a write barrier are, the difference between a concurrent and a stop-the-world pause, and what a system call has to allocate on the kernel heap.

## Contribution

The paper lists five contributions: Biscuit itself; a scheme for coping with kernel heap exhaustion; a qualitative discussion of where an HLL helped and where it did not; measurements of the performance tax of the HLL; and a direct Go-versus-C comparison of equivalent code.

- **Biscuit.** 27,583 lines of Go, 1,546 lines of assembly and no C, with 58 system calls, multi-core, kernel-supported threads, futexes, mmap, copy-on-write fork, a logging file system and TCP/IP sockets, plus Go drivers for AHCI SATA disks and Intel 82599-based Ethernet.
- **Heap reservations.** A static analysis tool, MaxLive (1,299 lines of Go), computes how much live heap each system call can need. The call waits at entry, with no locks held, until it can reserve that much, and after that its allocations cannot fail. Applications see delays instead of errors. When the heap nears exhaustion, a killer thread collects, drops cache entries, and kills the process with the most mapped regions, file descriptors and threads.
- **A modified Go runtime.** About 3,200 lines of Go and 1,000 of assembly, including a shim that supplies memory and execution contexts, per-goroutine allocation counts for reservations, and GC changes to cut delays.

## Methodology

Tests ran on a four-core 2.8 GHz Xeon X3460 with 16 GB, with a 10-gigabit Ethernet link to a Linux client. The three benchmarks are kernel-intensive: CMailbench (a mail-server-like workload built on fork, exec and rename), NGINX 1.11.5 serving a 612-byte file with 64 requests in flight, and Redis 3.0.5 (modified to use poll) with GET requests for 2-byte values. Most runs use an in-memory file system and last one minute, averaged over three runs with variation under 3%.

GC cost is measured as (O_gc minus O_nogc) over O_gc, where the no-GC run gets enough heap that it never collects. This does not remove the cost of checking whether write barriers are on. Compiler-inserted prologues, write barriers and safety checks are located in the binary and cross-referenced with CPU profiles. For Go versus C, the authors modify Biscuit and Linux 4.9.82 so that a pipe ping-pong and a page-fault loop follow nearly identical code paths. For Biscuit versus Linux they tune Linux by disabling costly features and replacing glibc with musl. The CVE study reads the patches of 65 Linux 2017 execute-code bugs by hand.

## Findings

All numbers below are from the paper's text and tables unless marked otherwise.

- **HLL tax (Figure 7).** GC takes 3% (CMailbench), 2% (NGINX) and 1% (Redis) of CPU, with 42, 32 and 30 collections. Function prologues cost 6%, 6% and 4%, write barriers 0.9%, 0.7% and 0.2%, and nil, bounds, divide and cast checks 3%, 2% and 2%. Allocator cycles (8%, 9%, 7%) are not an HLL-specific cost. Live heap data averaged 18 to 48 MB.
- **GC delays on NGINX.** 0.7% of allocator calls are delayed, 2% of system calls, and 22% of requests. The worst allocator delay is 115 microseconds (marking a large part of the TCP connection hashtable), the worst system call 574 microseconds (a poll), and the worst request 582 microseconds (the abstract rounds this to 600). Less than 0.3% of requests spend more than 100 microseconds collecting.
- **Headroom (Figure 8).** On CMailbench with 640 MB live data, GC share is 34% with 960 MB of heap, 19% with 1,280 MB and 9% with 1,920 MB. The authors advise a heap of 2 to 3 times the expected peak live data.
- **Go versus C.** Page faults: 731 ns for Go and 695 ns for C (C 5% faster). Ping-pong: 465,811 round trips per second for Go and 536,193 for C (C 15% faster), with 5,259 versus 4,540 instructions per round trip; prologues, write barriers, bounds and nil/type checks account for 250, 200, 144 and 112 instructions.
- **Biscuit versus Linux (Figure 9).** Linux over Biscuit: 1.07 on CMailbench in memory (17,034 versus 15,862 msg/s), 0.99 on CMailbench with SSD, 1.07 on NGINX and 1.09 on Redis.
- **CVEs.** Of 65 bugs, Go would have improved the outcome of 40 (8 use-after-free or double-free, 32 out-of-bounds, counted from Figure 6); 14 are logic bugs, and 11 are unclear. Many out-of-bounds cases would become panics instead of code execution. The Go runtime and packages had 14 CVEs from 2016 to 2018.
- **Heap exhaustion.** Live data reached about 500 MB, 97% of the 512 MB heap, while a well-behaved process saw no failed system call despite waiting for reservations hundreds of thousands of times; the killer fired four times in the first 35 seconds (read from the text of Figure 10).
- **Lock-free lookups.** A read-lock-free directory cache gives 15,862 msg/s against 14,259 with read locks, 11% more.

## Critical Analysis

The paper is unusually careful about its own claims. It draws no top-level conclusion about C versus an HLL, and says the Linux comparison is not illuminating about language because Linux has more features and different tradeoffs.

- **Scope.** Conclusions hold for Go 1.10 and these three workloads on four cores, mostly with an in-memory file system. Biscuit lacks scheduling priority (it inherits the Go scheduler), swapping, reverse mapping, users and ASLR, and is not optimized for many cores or NUMA.
- **Memory cost.** Garbage collection needs headroom, so efficient memory use favors C, as the authors say. Biscuit fixes its heap at 1/32 of RAM at boot, and the reservation scheme assumes the collector runs with almost no free memory. Go's collector may need memory for its work stack (at most 0.8% of heap RAM in the experiments; the fallback the authors describe is not implemented), and size-class fragmentation is not yet handled.
- **Constructed comparisons.** Linux was tuned (features disabled, musl instead of glibc) and both kernels were modified so the Go-versus-C paths match, so these are not results for stock Linux. The paper says so, and the Go-versus-C paths are small (about 480 to 650 lines for page faults, 1,200 to 1,786 for ping-pong).
- **Reading, not the paper's claim.** The CVE study counts bug types in patches; it does not give bug density per line, and a Go kernel would still need `unsafe` (90 uses in Biscuit) and would keep bug classes such as logic errors and counting errors (Biscuit itself keeps reference counts for objects needing cleanup, and a [refcounting study of Linux](/papers/refcounting-bugs-in-all-modern-linux-kernels) shows how common that class is). Ordering bugs of the kind [OZZ](/papers/ozz-kernel-out-of-order-concurrency-bugs) hunts are not in the paper's scope.
- **Later literature (not re-read for this analysis).** The catalog has Rust kernels that take the other route the paper mentions, [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) and [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness). The catalog's analysis of [Hyperkernel](/papers/hyperkernel-push-button-verification-of-an-os-kernel) says its team dropped a Rust kernel because of ownership and the cost of formalizing Rust. I rely on those catalog summaries only.

## Further Research

- The authors' own list: expanding and contracting the heap at run time, giving Biscuit control of scheduling policy, scaling to more cores, and testing whether heap reservations could simplify C kernels.
- Repeating the Go-versus-C comparison with a compacting or lower-overhead collector, or with Rust, which the paper expects might be faster but harder for threaded code.
- My suggestion, not the paper's: setting these costs next to the price of proving a kernel correct, as in [seL4](/papers/sel4-formal-verification-of-an-os-kernel) and [CertiKOS](/papers/certikos-extensible-architecture-for-certified-concurrent-os-kernels), and next to a mark-region collector such as [Immix](/papers/immix-mark-region-garbage-collector), since Biscuit's Go collector never moves objects.

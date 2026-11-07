---
title: "Fast, Flexible, and Practical Kernel Extensions"
summary: KFlex splits kernel safety in two, using the eBPF verifier for the kernel-owned side and cheap runtime checks (software fault isolation plus safe cancellation) for the extension's own memory and termination, so eBPF programs can use heaps, arbitrary data structures and unbounded loops without a new language.
researchArea: Operating Systems
keywords: kernel extensions, ebpf, software fault isolation, extension cancellation, extension heap, linux kernel
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Kernel extensions let an application push its own logic into the OS, and eBPF has made them common in Linux and Windows. The authors note that Meta is known to load 50 to 150 eBPF extensions on each server, and that Google, Netflix, Cloudflare, Apple, Alibaba and Dropbox report production uses. They name four properties an extension framework should have: safety, flexibility, performance and practicality (no new language or toolchain). Each earlier approach gives up one. Safe-language kernels such as SPIN are flexible and fast but need new languages and a new OS. Software fault isolation (SFI), as in VINO, is flexible and easy to adopt but pays for many runtime checks. Static verification, as in eBPF, is fast and practical but does not scale to arbitrary code: extensions cannot define data structures (only kernel-provided eBPF maps), loops need statically computable bounds, and only one lock can be held at a time.

This SOSP 2024 paper (Austin), from EPFL and UC Berkeley, argues that kernel safety is really two properties that deserve different mechanisms. The result is KFlex, built on Linux and the eBPF framework.

Terms worth keeping apart: kernel-interface compliance means touching kernel-owned memory and functions only as permitted. Extension correctness means accessing the extension's own memory safely and terminating. The extension heap is memory owned by the extension. Kie is KFlex's instrumentation engine, and a cancellation point (Cp) is an instruction where an extension may be forcibly stopped.

Worth knowing first: how the eBPF verifier and JIT work, what the XDP hook is, and the basic idea of SFI (mask a pointer into a sandbox). Two library papers take other routes to extending Linux: [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) delegates scheduling policy to userspace, and, from SOSP 2025, [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) loads page-cache eviction policies as eBPF. [PeeR](/papers/peer-first-class-scheduling-for-latency-critical-ebpf-applications) tackles the scheduling of long eBPF programs and includes Redis-KFlex among the applications it studies. The KFlex paper cites none of these three, so the links are mine.

## Contribution

- **Splitting safety.** The eBPF verifier keeps checking kernel-interface compliance, because those accesses carry semantic rules (for example invariants on kernel data structures). Lightweight runtime checks enforce extension correctness, because the kernel only needs the extension's own memory accesses to stay in bounds and the extension to stop. KFlex keeps eBPF's instruction set and kernel interface, so existing eBPF extensions run unmodified.
- **Extension heaps.** An extension declares a heap with `kflex_heap(size)` (size in GB), allocates with `kflex_malloc` and `kflex_free`, and may hold several instances of a queue-based `kflex_spin_lock` at once. The heap sits in its own part of the kernel virtual address space, aligned to its size, so it never aliases kernel memory. Physical pages are populated on demand and charged to the application's memory cgroup. The allocator backend is jemalloc in userspace, and the per-CPU caches it feeds are refilled by a userspace thread.
- **Lightweight SFI.** Kie masks each heap pointer to the bits that offset into the heap and adds the heap base, which on x86_64 compiles to a single AND plus indexed addressing (with registers R12 and R9 reserved for base and mask). It reuses the verifier's range analysis to drop guards on provably safe accesses. Guard pages of 32 KB sit on both sides because eBPF load and store offsets are signed 16-bit. An optional performance mode skips sanitizing reads, which gives up confidentiality (extensions can read arbitrary kernel memory) while writes stay sanitized and SMAP makes reads of user addresses trap.
- **Extension cancellations.** Cancellation points are the back edges of loops that cannot be proven to terminate, plus heap accesses. Kie adds a heap access (`*terminate`) at each back edge. To cancel, the runtime zeroes that address, the next access faults, and the runtime walks a per-point object table, computed from the verifier's symbolic execution, calling the destructor of each kernel object the extension holds (for example `bpf_sk_release`). The price is one rule: kernel resources acquired in a loop iteration must be released by its end. Detection is passive, using the Linux soft and hard lockup watchdogs at second granularity, and extensions are never stopped inside trusted helpers.
- **Sharing with userspace.** Userspace can `mmap` the heap. Kie translates stored pointers into the userspace mapping so both sides can walk the same linked structures. A userspace task holding a lock an extension may need can ask for a 50 µs time slice extension, kept as a counter in the rseq region. If it still does not release the lock, the extension spinning on it is eventually canceled.
- **Size.** KFlex is about 15k lines on Linux v6.9: 2.5k in the verifier and JIT, 8k for the runtime, 4.5k of unit tests. The authors report that it passes the whole eBPF test suite.

## Methodology

Two directly connected, identical machines (RFC 2544 style) each have a 96-core Intel Xeon Platinum 8468, 512 GB of RAM and a 10 Gbps Intel X710 NIC, running Ubuntu 24.04, with the server on the authors' modified Linux v6.9. The client runs a closed-loop generator with 64 threads and 16 clients per thread and measures at the client. Requests are Zipfian (s = 0.99), by default with 32 B keys and 64 B values, and each run lasts 30 seconds with the first 10% of samples discarded.

KFlex Memcached (about 2000 lines, at the XDP hook) is compared with userspace Memcached and BMC, an eBPF look-aside cache that offloads only GETs, on GET:SET mixes of 90:10, 50:50 and 10:90, with 8 server threads and again with 16. For these runs the value size drops to 32 B because BMC cannot handle values larger than keys. KFlex Redis (about 3100 lines, at the sk_skb hook) is compared with KeyDB, a parallel Redis. Separate experiments offload a hash table, linked list, red-black tree, skiplist and two network sketches, compared single-threaded with the same code as an unchecked kernel module, with and without performance mode, and offload Redis's ZADD (a hashmap pointing to skiplists). A co-design experiment runs Memcached garbage collection every second in userspace threads over the shared heap, and a last one counts the SFI guards the verifier lets Kie elide.

## Findings

These are the authors' reported results.

- **Memcached.** With 8 threads KFlex sustains 1.23× to 2.83× the throughput of BMC and 2.33× to 3.01× that of userspace Memcached, with p99 latency 1.41× to 1.95× lower than BMC and 1.95× to 9.35× lower than Memcached. The gap over BMC grows with the share of SETs, which BMC does not offload. The authors say 16 threads give similar benefits.
- **Redis.** Throughput is 1.61× to 2.14× that of KeyDB, with p99 latency 0.97× to 2.96× lower (the low end reads as slightly worse than KeyDB in one case, and the authors speak of ignoring an outlier). The gains are smaller than for Memcached because every Redis request crosses the Linux TCP stack before the extension sees it.
- **Offloading ZADD.** eBPF has no skiplist, so this cannot be offloaded today. With one server thread KFlex gives 1.65× the throughput of Redis and 52.8% lower p99 latency.
- **Data structures.** Against the unchecked kernel module, the average overhead is 9% in throughput and 31.7% in latency without performance mode. Performance mode trims the latency overhead by 3 to 4 points for the pointer-heavy linked list and skiplist, 1 to 2 for the hashmap and red-black tree, and nothing for the sketches. The authors blame part of the cost on eBPF itself, for example register pressure and a poor `memcpy`.
- **Co-design with userspace.** With garbage collection in userspace, KFlex Memcached still gives 2.2× to 2.9× the throughput and 42.8% to 89.5% lower tail latency than userspace Memcached. This is below the 2.33× to 3.01× and 1.95× to 9.35× measured without garbage collection, which the authors put down to contention on the shared hash table.
- **Verifier and SFI.** The verifier's range analysis elides on average 76% of the guards for update, lookup and delete across the data structures, and 100% for several operations. The guards left are mostly those where the scalar added to a pointer may exceed the heap size.

## Critical Analysis

The paper is open about the limits of its design. It concedes the following.

- **Linux's narrow interface.** Because eBPF was retrofitted, Linux exposes less to extensions than a kernel designed for extensibility. SPIN's canonical example, a web server in the kernel, is infeasible because extensions cannot read files or do blocking I/O. The authors argue this is not fundamental, since the interface keeps widening.
- **Stalls are slow to cancel.** Watchdog-driven cancellation works at second granularity, which "may not be ideal", and a cancellation caused by non-termination on one CPU stops the extension on every CPU.
- **Scope of safety.** KFlex protects the kernel, not the extension: memory bugs inside the heap and the functional correctness of extensions are out of scope, and a canceled extension is not repaired. Performance mode gives up read confidentiality and is meant for trusted settings.
- **Engineering limits.** The size-aligned heaps plus guard pages fragment kernel address space, so the number of heaps is limited. Upstream eBPF arenas cap at 4 GB. eBPF also lacks SIMD and a formal memory model, and has few registers.

The following points are a reading of the evidence, not claims of the paper.

- **Cancellation is never exercised in the evaluation.** The near-zero overhead of `*terminate` rests on the authors' experience that the `*terminate` location is usually in the L1 cache, and no experiment stalls an extension, deadlocks it against a userspace lock holder, or reports recovery time. Cancellation is half of the new safety story, so it has design but no measurement.
- **The SFI claim is a static proxy.** Table 3 counts guard instructions emitted, not executed, and no run disables elision to show the speed gained. The text's 76% matches the mean of the twelve per-operation percentages, while by raw count the table gives 79 of 99 guards, about 80%. Hashmap lookup elides 0 of 2, and skiplist delete (the structure behind ZADD) only 44%. The text does not say whether Memcached and Redis ran in performance mode, since that study is only for data structures. The 31.7% average latency overhead is also much larger than the 9% throughput overhead, a gap the text does not explain.
- **Baselines and load shape.** The userspace baselines go through the Linux network stack, so the gains compare a kernel fast path with an ordinary userspace server. IX and Arrakis motivate the work but are not baselines. The load is closed-loop with a fixed 1,024 clients, so there are no latency-versus-load curves, p99 comes from one saturated operating point, and the paper gives no run-to-run spread ("similar results" over several minutes). The BMC comparison uses 32 B values only.
- **Newer upstream feature, no comparison.** The authors say eBPF arenas reach feature parity with heaps (up to 4 GB) and that they are migrating to them. The evaluation does not state heap sizes or compare against arenas, so a workload that needs more than 4 GB is not demonstrated.
- **Trusted base.** The paper itself cites verifier bugs as the cost of growing the verifier, yet KFlex adds 2.5k lines to the verifier and JIT plus 8k of runtime. The correctness evidence reported is unit tests and the eBPF test suite, with no fuzzing or formal argument for Kie's instrumentation.
- **What practitioners can use.** Offloading SETs needed the authors' own support for TCP's fast path at XDP, whose size is not given. The abstract says several mechanisms are upstreamed, but Section 4.5 lists only initial cancellation support and stack unwinding as merged, with object tables and performance mode under review.

## Further Research

- Sub-second stall recovery by sampling a hardware clock at loop back-edge cancellation points, and cancellation scoped to one invocation on one CPU, both named by the authors.
- Denser packing of heap regions by striping heap domains with Intel MPK and dropping guard pages, so heaps can be both many and larger than 4 GB, also planned by the authors. The same line includes porting the extensions to upstream arenas.
- Stacking stronger guarantees on KFlex's kernel safety: extensions written in Rust, or verified with toolchains such as Dafny. [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) shows the opposite route, a Rust kernel verified with Verus (the KFlex paper does not cite it).
- Gaps I see: fault-injection runs for cancellation, a comparison of cancellation with the preemption approach of [PeeR](/papers/peer-first-class-scheduling-for-latency-critical-ebpf-applications), and latency-versus-load curves for the offloaded Memcached and Redis.

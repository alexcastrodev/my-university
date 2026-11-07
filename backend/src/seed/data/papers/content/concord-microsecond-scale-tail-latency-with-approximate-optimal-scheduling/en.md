---
title: "Achieving Microsecond-Scale Tail Latency Efficiently with Approximate Optimal Scheduling"
summary: Concord is a scheduling runtime that approximates the textbook tail-optimal design (one queue, precise preemption) with cheaper mechanisms, namely compiler-inserted yield points instead of interrupts, short bounded per-worker queues, and a dispatcher that also runs requests, so it sustains more throughput at the same tail-latency target.
researchArea: Operating Systems
keywords: tail latency, scheduling, preemption, compiler instrumentation, jbsq, single queue, microsecond-scale
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Datacenter services answer requests in microseconds yet face strict tail-latency targets, because a user request fans out to many servers and the slowest one sets the response time. At one server, tail latency is dominated by queueing delay. Queueing theory says that First Come, First Served (FCFS) is optimal for light-tailed workloads, that Processor Sharing (PS) is optimal for heavy-tailed ones, and that a single queue beats several. State-of-the-art runtimes therefore pair one queue with preemption, but the authors argue this costs throughput. They cite a 20% throughput penalty for Shinjuku's preemption at a 5 µs quantum and 50% at 2 µs. Shinjuku also depends on non-standard use of virtualization hardware, which rules out public-cloud VMs, and Persephone needs the service-time distribution in advance.

This SOSP 2023 paper (Koblenz), from EPFL and Imperial College London, presents Concord. It adds no new policy. It adds mechanisms that approximate the optimal ones cheaply, accepting slightly imprecise scheduling in exchange for throughput.

Terms worth keeping straight. The dispatcher is the thread that owns the queue and hands requests to pinned worker threads. The quantum is how long a request may run before it is preempted. JBSQ(k), Join-Bounded Shortest Queue, adds a bounded queue of depth k per worker. A blind policy uses no application-level knowledge. Slowdown is the time a request spends at the server divided by its un-instrumented service time.

Worth knowing first: the FCFS versus PS trade-off, the cost of a context switch and of an inter-processor interrupt (IPI), and cache-coherence misses between cores. The paper cites [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) as a production scheduler with different priorities (multi-tenancy, fault isolation), and cites [Snap](/papers/snap-microkernel-approach-to-host-networking) and [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) among systems with microsecond-scale targets. Two pairings of mine, not the paper's: the later [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) paper names Concord among systems that preempt but dedicate cores to one application, and [PeeR](/papers/peer-first-class-scheduling-for-latency-critical-ebpf-applications) also preempts at known points (eBPF helper calls) instead of by interrupt.

## Contribution

- **An overhead model.** Using one dispatcher and n pinned workers, the authors split lost cycles into three sources: preemption (notification cost plus instrumentation), synchronous dispatcher-worker handoff, and a dispatcher that runs no application code. Concord answers each with one mechanism.
- **Compiler-enforced cooperation.** The dispatcher times each request and, when the quantum ends, writes to a dedicated cache line per worker. Compiler instrumentation makes application code poll that line. On seeing the signal the worker acknowledges, saves the request context, switches to its default context and yields, and the dispatcher requeues the request. Probes sit at function entries, around calls to un-instrumented code and at loop back-edges, and loops are unrolled to at least 200 LLVM IR instructions. Most checks are an L1 hit plus a compare (about 2 cycles), and the final check is a coherence miss of about 150 cycles, against about 1,200 cycles for a Shinjuku IPI and about 30 for `rdtsc()`. Yielding is imprecise, since the worker only stops at its next probe.
- **Safety-first preemption.** Workers are never preempted inside external calls such as system calls, or while holding an application lock. The compiler controls what it instruments, so libc needs no changes. For locks, developers increment and decrement a counter around lock and unlock, and the authors needed 4 lines in LevelDB.
- **JBSQ(k) for stall-free workers.** The dispatcher pushes each request to the shortest per-worker queue that has a free slot, so a worker finishing a request finds the next one already local. The authors found k = 2 enough for service times above 1 µs and suggest k of about the handoff cost divided by service time, plus one. They say they are the first to note that JBSQ(k) is needed to mask cache-coherence latency in this setting.
- **A work-conserving dispatcher.** When all per-worker queues are full, the dispatcher runs a request for one quantum, self-preempting through `rdtsc()` probes. It therefore uses a second build of the application code, so it only takes requests that have not started and finishes what it starts, parking its context in a private buffer.
- **API and size.** Applications provide three callbacks (`setup`, `setup_worker`, `handle_request`). Two LLVM 9 passes of about 350 lines each do the instrumentation. Concord was integrated into Shinjuku with 847 added lines and into Persephone with 2,358, which also needed user-level threading ported from Shinjuku.

## Methodology

Two directly connected CloudLab c6420 machines, each a 32-core Xeon Gold 6142 at 2.60 GHz with 376 GB of RAM and a 10 Gbps Intel X710 NIC, with a 10 µs round trip. The server runs Ubuntu 18.04 on Linux 4.4.185, the version Shinjuku's kernel module requires, with 14 workers on dedicated physical cores. Arrivals are Poisson, each run lasts 60 seconds with the first 10% of samples discarded, and latency is measured at the client.

The baselines are Shinjuku and Persephone, limited to blind policies. Persephone is configured as C-FCFS ("Persephone-FCFS") for low-dispersion workloads, and all runs on the authors' cluster use Concord built on Shinjuku. The metric is throughput sustained at a 99.9th percentile slowdown of 50×. Synthetic workloads spin for the requested time: Bimodal(50:1, 50:100), Bimodal(99.5:0.5, 0.5:500), Fixed(1) and a TPCC mix. Real workloads use LevelDB with 15,000 keys held in memory (GET about 600 ns, PUT and DELETE about 2.3 µs, SCAN about 500 µs), once with 50% GET and 50% SCAN and once with a ZippyDB-based mix of 78% GET, 13% PUT, 6% DELETE and 3% SCAN. Quanta are 5 µs and 2 µs, and 10 µs for TPCC. Further experiments cover an ablation, 24 benchmarks from Phoenix, Parsec and Splash-2, a 4-core configuration, a queueing simulation and a 192-core Sapphire Rapids server.

## Findings

These are the authors' reported results.

- **Where the overhead goes.** Shinjuku's IPIs cost about 1,200 cycles to receive, which the model turns into about 12% overhead at 5 µs and 30% at 2 µs, and the measured overhead is 33% at 2 µs and 6% at 10 µs. `rdtsc()` instrumentation costs about 21% at every quantum. Concord's overhead stays near 1% to 1.5%, and it breaks even with IPIs around 25 µs.
- **High-dispersion synthetic loads.** Compared with Shinjuku, Concord sustains 18% and 20% more throughput at a 5 µs quantum on the two bimodal loads, and 45% and 52% more at 2 µs. Persephone-FCFS crosses the slowdown target much earlier.
- **Low-dispersion loads.** On Fixed(1), Concord gets 2% less than Shinjuku and Persephone, because the dispatcher is the bottleneck and computes the shortest queue. On TPCC, Persephone-FCFS beats both preemptive systems, and Concord still beats Shinjuku.
- **LevelDB.** With 50% GET and 50% SCAN (dispersion of 1000×) Concord sustains 52% more at 5 µs and 83% more at 2 µs. On the ZippyDB mix it sustains 19% more at 5 µs.
- **Ablation.** For the 50/50 LevelDB load, Shinjuku sustains about 19 kRps at the target. Adding cooperation gives about 22.5, then JBSQ(2) about 32, then the dispatcher about 35.
- **Mechanism checks.** With every request preempted, Concord cuts preemption overhead 4× against Shinjuku, and cooperation contributes most. JBSQ(2) lowers worker idle overhead 9× to 13×. A work-conserving dispatcher adds 33% throughput in a 4-core setup (1 dispatcher, 1 networker, 2 workers).
- **Instrumentation.** Across 24 benchmarks the average overhead is 1.04% (maximum 6.7%), against 13.7% (maximum 37%) in published Compiler Interrupts numbers, so 13.1× lower on average and 5.5× at the maximum. At a 5 µs quantum the standard deviation of the achieved quantum is below 2 µs (average 0.29 µs, maximum 1.8 µs).
- **Locks and hardware.** In a microbenchmark the authors built, Shinjuku could not preempt for 100 µs inside a long LevelDB GET and Concord gave 4× the throughput. Against Intel's user-space IPIs on a Sapphire Rapids server, Concord's overhead is about 2× lower.

## Critical Analysis

The paper states its costs openly. It concedes the following.

- **Higher slowdown at low load.** The dispatcher sometimes takes a request during a burst and cannot migrate it later, which raises the 99.9th percentile slowdown by about 3 over Shinjuku at low load. The authors accept it and say work stealing can be switched off.
- **Source code and one dispatcher.** The prototype needs source in an LLVM-compiled language, so it does not suit a runtime offered by a cloud provider, and binary instrumentation is planned. A single dispatcher can bottleneck as cores grow and service times shrink, and the authors suggest replication or batching.
- **Safety by convention.** Not preempting in system calls or critical sections can in theory cause spikes, which the authors call rare in practice. Multi-tenancy and fault isolation, which ghOSt provides, are left for future work.

The following points are a reading of the evidence, not claims of the paper.

- **The text disagrees with itself in places.** The introduction says up to 18% at a 5 µs quantum on synthetic loads, while the evaluation gives 18% and 20%. Section 3.1 says 25 benchmarks, while Table 1 and Section 5.4 have 24. Section 5.1 says Section 4 details the gap between Concord-Shinjuku and Concord-Persephone, but Section 4 gives only line counts, so "minuscule" is not shown. At 2 µs the text gives Shinjuku 33% overhead and Concord 12× less, which is about 2.8%, yet also calls Concord near-constant at 1% to 1.5%. This analysis uses the body figures.
- **Timeliness is validated at a different scale than the biggest wins.** The simulation uses a 5 µs mean and the standard deviation was measured only at a 5 µs quantum, on compute benchmarks, while the largest gains (45% to 83%) are at 2 µs, where a deviation like the 1.8 µs maximum seen at 5 µs would be nearly the whole quantum.
- **The instrumentation comparison is indirect.** The Compiler Interrupts numbers are published ones, since the authors could not replicate them, and Concord's overhead is often negative because of loop unrolling, which pulls the 1.04% average down.
- **One testbed, two baselines.** Everything runs on two bare-metal machines with 14 workers. Public-cloud deployability is argued from the mechanism, and the only small-VM evidence is a 4-core emulation. Shenango, Caladan, ZygOS and ghOSt are discussed but not run, so the extension to single-logical-queue systems is a plan.
- **No spread reported.** Each run lasts 60 seconds, and the text gives no repetitions or error bars. Gains are read where curves cross the target, which is steep near saturation, so a gap such as 18% against 20% could be noise. The claim that low-load slowdown rises "across all workloads" is shown for one.
- **Narrow evidence for the safety claim.** "Negligible effort" rests on 4 lines in one application, and LevelDB ran fully in memory, where system calls and blocking I/O are absent, which is where never preempting in external calls would matter. The reason for using only a 5 µs quantum on ZippyDB (all requests longer than 2 µs) also sits oddly with the 600 ns GETs reported in the same section.
- **The dispatcher gain depends on load.** It needs an idle dispatcher, and the 33% figure is one workload at low absolute load.

## Further Research

- Binary-level instrumentation, so tenants need not share source code, which the authors plan.
- Several dispatchers, or Concord's cooperation and stealing on top of single-logical-queue systems such as Shenango and Caladan, plus multi-tenant policies and fault isolation in the style of ghOSt, all named by the authors.
- Compiler-enforced cooperation beyond scheduling, for garbage collection, timer management, `membarrier()` and confidential VMs where hypervisor-injected interrupts are untrusted, as the authors suggest.
- Measuring timeliness at 2 µs quanta, on services that make system calls, block on I/O or hold long critical sections, inside a real public-cloud VM and with repeated runs.

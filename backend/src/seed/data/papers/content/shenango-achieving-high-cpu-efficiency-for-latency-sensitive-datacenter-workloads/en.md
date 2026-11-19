---
title: "Shenango: Achieving High CPU Efficiency for Latency-sensitive Datacenter Workloads"
summary: Shenango reassigns cores among applications every 5 µs. A dedicated IOKernel core watches thread and packet queues, grants a core when anything has waited two consecutive checks, and per-application runtimes with work stealing run the threads, so memcached keeps tail latency near ZygOS while idle cycles go to batch work.
researchArea: Operating Systems
keywords: core allocation, CPU efficiency, kernel bypass, IOKernel, work stealing, tail latency, user-level threads
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Datacenter applications demand microsecond-scale tail latencies and high request rates from operating systems, and most applications handle loads that have high variance over multiple timescales. Achieving these goals in a CPU-efficient way is an open problem. Because of the high overheads of today's kernels, the best available solution to achieve microsecond-scale latencies is kernel-bypass networking, which dedicates CPU cores to applications for spin-polling the network card. But this approach wastes CPU: even at modest average loads, one must dedicate enough cores for the peak expected load. Shenango achieves comparable latencies but at far greater CPU efficiency. It reallocates cores across applications at very fine granularity, every 5 µs, enabling cycles unused by latency-sensitive applications to be used productively by batch processing applications. It achieves such fast reallocation rates with (1) an efficient algorithm that detects when applications would benefit from more cores, and (2) a privileged component called the IOKernel that runs on a dedicated core, steering packets from the NIC and orchestrating core reallocations. When handling latency-sensitive applications, such as memcached, we found that Shenango achieves tail latency and throughput comparable to ZygOS, a state-of-the-art, kernel-bypass network stack, but can linearly trade latency-sensitive application throughput for batch processing application throughput, vastly increasing CPU efficiency.

## Overview

A request to a datacenter service fans out to many others, so tail latency (the 99.9th percentile) must stay at microsecond scale even for requests that take a couple of microseconds of CPU. Linux only manages that when most cores sit idle, and kernel-bypass stacks such as [IX](/papers/ix-protected-dataplane-operating-system) and [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) avoid the kernel scheduler but spin-poll the NIC, so a core given to one application is busy whether or not packets arrive. The authors add that Linux rebalances roughly every 4 ms, and that Arachne and IX adjust cores every 50 to 100 ms.

This NSDI 2019 paper, from MIT CSAIL, asks for the missing piece: move cores between applications at the pace of the load itself, which can change in microseconds (the paper cites Bing threads becoming runnable 15 at a time within 5 µs). It builds on the two-level idea of [scheduler activations](/papers/scheduler-activations-user-level-management-of-parallelism), with a core allocator on top and a thread scheduler inside each application, and ties the allocator to the network path.

Worth knowing first: RSS (the NIC hashes flows to per-core queues), spin-polling, and the difference between CPU efficiency (cycles spent on application work) and CPU utilization (cycles not idle).

## Contribution

- **Congestion detection every 5 µs.** The IOKernel looks at each runtime's thread run queues and ingress packet queues. If any item was already queued at the previous check, the runtime is "congested" and gets one more core. The authors prefer queueing duration to queue length because length needs a threshold tuned per request size. A packet for a runtime with no cores gets one at once.
- **The IOKernel.** A privileged process on a dedicated, busy-spinning core. It polls the NIC (via DPDK), steers each packet to a core of the owning runtime, polls the egress queues of active cores only, and picks which core to grant: a hyperthread sibling first, then the core the application used last, then any idle core.
- **Runtime per application.** Linked into the process, untrusted, with uthreads on per-core run queues, work stealing, run-to-completion, blocking TCP and UDP sockets, mutexes and RCU. Cores are guaranteed or burstable. A kthread with no work parks and returns its core. Packet processing, including TCP, can be stolen across cores, which breaks flow-consistent hashing and is paid for with resequencing.
- **Implementation on stock Linux.** 2,244 lines for the IOKernel, 6,155 for the runtime and 4,762 of shared library code, in C with C++ and Rust bindings. Preemption uses SIGUSR1, parking uses an eventfd, and TCP is written from scratch (flow control and fast retransmit, no congestion control).

## Methodology

Two analyses and one testbed. A simulator (M/M/n/FCFS, Poisson arrivals, 10 µs mean exponential service, 99.9th percentile limit of 100 µs) bounds the efficiency of any allocator that adjusts once per millisecond. The evaluation then uses one 12-core Xeon E5-2650v4 server (first socket only, hyperthreads on, TurboBoost and C-states off, 10 Gbit/s NIC) and six client machines generating open-loop Poisson load. Everything is confined to 16 hyperthreads, and the IOKernel takes two of them. Baselines are Linux, Arachne and ZygOS. Workloads are memcached (USR mix: 99.8% GET), a spin-server with constant, exponential and bimodal service times, and the gdnsd DNS server, each beside the PARSEC swaptions batch job. Microbenchmarks cover threads, packet load balancing and the allocation interval.

## Findings

These are the authors' reported results, from the text unless marked as read from a chart.

- **Memcached.** Over 5 million requests/s with median 37 µs and 99.9th percentile 93 µs. ZygOS keeps similar latency only up to about 4 million, though it scales to higher throughput at a high latency cost, because Shenango's IOKernel is the bottleneck below roughly 2 µs of service time. Batch throughput falls linearly as memcached load rises, while ZygOS gets none.
- **Linux and Arachne.** At 0.4 million requests/s Linux has 83 µs at the 99.9th percentile alone and over 2 ms with batch work; Arachne stays under 200 µs with batch work.
- **Bursts.** Load jumping from 100,000 to 5 million requests/s adds almost no tail latency (below 125 µs per the introduction). Arachne can need over 500 ms to add cores and shows milliseconds of tail latency.
- **Simulation.** At 5 µs Shenango's efficiency beats the 1 ms upper bound, per the text and Figure 1.
- **DNS.** gdnsd reaches 5.7 million requests/s with 73 µs at the 99.9th percentile, 6.33x Linux's 900,000.
- **Mechanisms.** A core reallocation takes 5.9 µs and under 2 µs of IOKernel time. Per-operation costs in ns (Shenango vs Go): mutex 37 vs 24, yield 52 vs 109, condvar 100 vs 281, spawn-join 148 vs 462. Under 3% of packets arrive out of order with 24 connections. Longer intervals cost at least 150 µs of tail latency, against up to 6% less batch work at 5 µs.
- **Packet rate.** The IOKernel handles up to 6.5 million packets/s, enough for a 10 Gbit/s NIC with 114-byte packets.

## Critical Analysis

What the paper concedes: the IOKernel is a dedicated core (two hyperthreads here) and a bottleneck for very short requests; it was not evaluated on multi-socket NUMA machines; a kthread that ignores a preemption signal is not mitigated yet; ingress buffers sit in one shared read-only region; zero-copy was dropped; and preemption inside an application, as in [Shinjuku](/papers/shinjuku-preemptive-scheduling-for-usecond-scale-tail-latency), is left to future work.

The following points are a reading of the evidence, not claims of the paper.

- **Scheduling is per machine.** The IOKernel decides only among applications on one server. Nothing about placement across machines, and no cluster-level result.
- **Evaluation scope.** The runs use one latency-sensitive application at a time beside a single batch job (swaptions, compute-bound), a 10 Gbit/s NIC, and Meltdown mitigations disabled. The paper does not show two latency-sensitive applications contending, and cache and memory-bandwidth interference is not measured.
- **Baselines.** ZygOS ran on an older kernel because it was unstable on recent ones, and Linux was tuned by the authors, a normal limit of such comparisons.
- **Cost of the dedicated core.** On 16 hyperthreads, two (12.5%, my arithmetic) go to the IOKernel. The paper shows Linux ahead on batch throughput at the lowest loads because of it.

Later literature, marked as such. The [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space) and [Concord](/papers/concord-microsecond-scale-tail-latency-with-approximate-optimal-scheduling) analyses in this catalog say, respectively, that Shenango reallocates cores fast but lacks preemption inside an application, and that Shenango and Caladan are single-logical-queue systems Concord only plans to extend to. [Orthrus](/papers/orthrus-detecting-silent-user-data-corruption-in-the-cloud) runs its validators on Shenango user threads, per its analysis here. I read only the USENIX abstract of Caladan (Fried, Ruan, Ousterhout and Belay, OSDI 2020), not its text: it describes a scheduler core that manages contention in the memory hierarchy and between hyperthreads, and reports cutting tail latency from 580 ms to 52 µs against Parties.

## Further Research

- Scaling the IOKernel: one per socket, or NIC offloads that expose queue buildup, as the authors suggest.
- Preemption and thread-local storage inside a runtime for heavy-tailed workloads, which the authors leave open.
- Comparing the efficiency claim with the in-kernel and ghOSt-style approaches ([ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling), [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs)): do they reach similar latency without a spinning core?
- Packet-level security and accounting, which the paper assumes will be handled out-of-band.

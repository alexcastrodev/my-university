---
title: "Shinjuku: Preemptive Scheduling for μsecond-scale Tail Latency"
summary: Shinjuku is a single-address-space OS that uses virtualization hardware (posted interrupts under Dune) to preempt requests every 5 to 15 µs from one centralized dispatcher, so short requests stop queuing behind long ones, with up to 6.6x the throughput and 88% lower tail latency than ZygOS on RocksDB.
researchArea: Operating Systems
keywords: tail latency, preemptive scheduling, centralized dispatcher, Dune, posted interrupts, request scheduling, dataplane OS
version: 1.1
updatedAt: 2026-11-20
---

## Abstract

The recently proposed dataplanes for microsecond scale applications, such as IX and ZygOS, use non-preemptive policies to schedule requests to cores. For the many real-world scenarios where request service times follow distributions with high dispersion or a heavy tail, they allow short requests to be blocked behind long requests, which leads to poor tail latency. Shinjuku is a single-address space operating system that uses hardware support for virtualization to make preemption practical at the microsecond scale. This allows Shinjuku to implement centralized scheduling policies that preempt requests as often as every 5 µsec and work well for both light and heavy tailed request service time distributions. We demonstrate that Shinjuku provides significant tail latency and throughput improvements over IX and ZygOS for a wide range of workload scenarios. For the case of a RocksDB server processing both point and range queries, Shinjuku achieves up to 6.6x higher throughput and 88% lower tail latency.

## Overview

A user request fans out to many servers, so the slowest one sets the response time, and each service needs tail latency of tens to a few hundred microseconds. Kernel-bypass dataplanes get there with RSS, which spreads flows over per-core queues served first-come-first-served without interruption (d-FCFS). [IX](/papers/ix-protected-dataplane-operating-system) is the canonical case, and ZygOS adds work stealing to approximate one shared queue (c-FCFS). Both are non-preemptive, so when service times have high dispersion (bimodal, log-normal, Zipf, Pareto) a short request stuck behind a long one inherits its delay. Queueing theory says processor sharing (PS) fits such loads, and PS needs preemption, which Linux offers only at millisecond scale (CFS target 6 ms, minimum 0.75 ms).

This NSDI 2019 paper, from Stanford and MIT, makes preemption cheap enough to use every few microseconds. It belongs to the line that started with [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) and continued with [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) and IX, and which also echoes the lesson of [receive livelock](/papers/eliminating-receive-livelock-in-an-interrupt-driven-kernel). Later schedulers compare against Shinjuku or reimplement it: [Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space), [Concord](/papers/concord-microsecond-scale-tail-latency-with-approximate-optimal-scheduling) and [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) (which ships a Shinjuku-style policy), and [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs) attacks the same head-of-line blocking inside the kernel.

Worth knowing first: RSS, the difference between d-FCFS, c-FCFS and PS, and what a Dune process is (a Linux process running in VMX non-root mode, with direct access to privileged CPU features).

## Contribution

- **Cheap preemption.** The dispatcher sends an inter-processor interrupt (IPI) without a VM exit, by mapping the real APIC and the workers' posted-interrupt descriptors into its guest physical space through the EPT. The worker receives it as a posted interrupt, also without an exit. Table 1 gives 298 cycles at the sender and 1,212 at the receiver (1,993 cycles total), against 2,084 and 2,523 (4,950) for a Linux signal. The authors say this keeps 5 µs preemption under 10% of worker throughput.
- **Cheap context switch.** A modified ucontext skips the signal mask (a system call that costs a VM exit in Dune) and the floating-point save or restore that is not needed, bringing a switch to 36 to 109 cycles (swapcontext costs 2,290 in Dune).
- **One centralized dispatcher.** Networking (one hyperthread, based on IX) hands requests to a dispatcher that queues and schedules them onto workers. A preempted request returns to the dispatcher with its context. Threads talk through pairs of cache lines (211 cycles round trip), and a dispatcher can in theory handle 28 MRPS. Several dispatchers scale further, with RSS steering requests among them.
- **Two policies.** Single queue (SQ): one FCFS queue, preempt anything past a quantum of 5 to 15 µs, put it at the tail (approximates PS) or at the head (approximates c-FCFS). Multi queue (MQ): one queue per request type with its own SLO, chosen by the largest ratio of queuing time to SLO (inspired by BVT), which needs the network stage to identify types.

## Methodology

Section 2 uses a discrete event simulator of 16 cores, without overheads, to compare d-FCFS, c-FCFS, PS and the preemptive policies. The evaluation uses one server (two E5-2658 at 2.3 GHz, 128 GB, a 10 GbE Intel 82599ES, Linux 4.4) and six clients through an Arista switch, with an open-loop load generator and 1,920 connections. IX and ZygOS support at most 16 RSS queues, so most runs use 16 hyperthreads: Shinjuku(16) spends two on networking and dispatcher and 14 on workers. IX runs over UDP with batch 64 and ZygOS over TCP, with one segment per request. Workloads are a synthetic server with controllable service times and RocksDB 5.13 held in memory (GET about 6 µs, SCAN of 1,000 or 5,000 keys at 240 or 1,200 µs), with a 15 µs slice. Shinjuku is about 1,365 SLOC of Dune changes plus 2,535 of dispatcher and workers.

## Findings

All of these are the authors' figures, as stated in the text; where only the plot gives the value it is marked "chart reading".

- **Light tails.** On Fixed(1) and Exp(1), Shinjuku(SQ) is close to IX and beats ZygOS, which steals 60% of the time even on homogeneous loads. Chart reading: Shinjuku saturates near 4.3 MRPS, IX near 5.
- **Bimodal(99.5% at 0.5 µs, 0.5% at 500 µs).** Up to 50% lower tail latency at low load and 5x the throughput at a 300 µs target. Chart reading: IX and ZygOS saturate below 1 MRPS and Shinjuku near 4.3.
- **Multiple types (MQ).** On Bimodal(50-1, 50-100) and Trimodal, 94% lower 99th percentile slowdown at low load and over 2x the throughput. Chart reading: about 260 kRPS against about 80 for IX in the bimodal case.
- **Preemption interval.** On Bimodal(50-1, 50-100), shorter slices are better, and 5 µs performs well (chart reading: about 230 kRPS before slowdown climbs, against about 120 for 100 µs).
- **Scaling.** One dispatcher scales almost linearly to 11 workers and schedules 5M RPS, two schedule 9.5M RPS over 22 workers, and a 40 GbE NIC saturates with 258-byte replies.
- **RocksDB.** With 99.5% GET and 0.5% SCAN(1000), Shinjuku improves on ZygOS by 88% in tail latency and 6.6x in throughput, and IX is worse. The text gives no load point for the 88%. Chart reading: GET stays near 40 µs up to about 550 kRPS.
- **Preemption matters.** With 50% GET and 50% SCAN(5000), SQ without preemption favors SCANs over GETs, SQ fixes that, MQ also helps SCANs, and ZygOS does worse than Shinjuku without preemption. IX is omitted as off the plot.
- **Connections.** RSS needs about 16,000 connections for under 10% imbalance on 24 hyperthreads (Monte Carlo), while 300 suffice for two dispatchers.

## Critical Analysis

What the paper does not claim or measure:

- **No price for Dune.** It needs VT-x, Dune changes, and in the evaluation Linux 4.4. Applications ran in VMX non-root ring 0, so runtime and application must trust each other, and mapping the APIC lets one process flood another's core with interrupts. The ring 3 to ring 0 round trip is measured at 84 cycles, but running applications in ring 3 is future work.
- **Dedicated, spinning cores.** Two of 16 hyperthreads go to networking and the dispatcher, and workers are pinned. There is no measurement of CPU efficiency, energy, or cores lost on light loads. Adjusting workers over time is left to a future integration with Shenango.
- **One application per instance.** The text says each low-latency application gets its own Shinjuku instance, but never evaluates several instances, co-location with batch work, or sharing cores.
- **Narrow evaluation.** One server, a 10 GbE link, in-memory RocksDB (tmpfs, memory-mapped tables), no flash, 99th percentile only. Shinjuku has 14 workers against 16 for the rivals, and the transports differ (UDP against TCP). Quanta and SLOs are set by hand, and online inference of the service-time distribution is future work.
- **Application cooperation.** Non-thread-safe code runs with interrupts disabled (`call safe(fn)`), and allocation functions too, so long allocations hurt the tail. Large memory footprints make preemption expensive, which is left to future locality-aware policies.
- **Small inconsistencies.** The introduction says Shinjuku matches IX and ZygOS on light tails, while Section 4.2 says close to IX and better than ZygOS. The 10% overhead claim uses a 2 GHz clock in the text while the testbed runs at 2.3 GHz. Dividing 1,212 cycles by a 5 µs slice at 2 GHz (my arithmetic) gives about 12% before the context switch.

Later literature, as read in this catalog's analyses and not in the original papers: Concord reports that Shinjuku's preemption costs about 20% of throughput at a 5 µs quantum and 50% at 2 µs, and that its virtualization tricks rule out public-cloud VMs. Skyloft says Shinjuku cannot give a batch application any CPU share. [Shenango](/papers/shenango-achieving-high-cpu-efficiency-for-latency-sensitive-datacenter-workloads) came out at the same venue in the same year, and [Caladan](/papers/caladan-mitigating-interference-at-microsecond-timescales) followed at OSDI 2020; both have their own analysis in this catalog, and this analysis does not compare their numbers with Shinjuku's.

## Further Research

- Preemption without virtualization hardware: compiler-inserted yield points ([Concord](/papers/concord-microsecond-scale-tail-latency-with-approximate-optimal-scheduling)) or user interrupts ([Skyloft](/papers/skyloft-general-scheduling-framework-in-user-space)).
- Core reallocation between latency-critical and batch applications, which the authors defer.
- Dynamic choice of policy and quantum from live service-time profiles, and locality-aware policies.
- Hardware message passing among cores to scale the dispatcher, and lightweight user-level interrupts.

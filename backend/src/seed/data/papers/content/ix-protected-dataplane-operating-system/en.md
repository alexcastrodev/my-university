---
title: "IX: A Protected Dataplane Operating System for High Throughput and Low Latency"
summary: IX splits the OS into a Linux control plane and per-application dataplanes that run in a protected ring with Dune, process bounded batches of packets to completion, and share no state between cores, beating Linux and mTCP on throughput and latency.
researchArea: Operating Systems
keywords: dataplane operating system, kernel bypass, run to completion, adaptive batching, zero-copy, hardware virtualization, tail latency, multicore scalability
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

The conventional wisdom is that aggressive networking requirements, such as high packet rates for small messages and microsecond-scale tail latency, are best addressed outside the kernel, in a user-level networking stack. We present IX, a dataplane operating system that provides high I/O performance, while maintaining the key advantage of strong protection offered by existing kernels. IX uses hardware virtualization to separate management and scheduling functions of the kernel (control plane) from network processing (dataplane). The dataplane architecture builds upon a native, zero-copy API and optimizes for both bandwidth and latency by dedicating hardware threads and networking queues to dataplane instances, processing bounded batches of packets to completion, and by eliminating coherence traffic and multi-core synchronization. We demonstrate that IX outperforms Linux and state-of-the-art, user-space network stacks significantly in both throughput and end-to-end latency. Moreover, IX improves the throughput of a widely deployed, key-value store by up to 3.6x and reduces tail latency by more than 2x.

## Overview

This OSDI 2014 paper (Stanford and EPFL) addresses datacenter services that need high packet rates for small messages, tight tail latency, many connections and isolation between tenants. Commodity kernels were designed for many applications sharing one core and for packet inter-arrival times far above interrupt latency, so they pay in latency and throughput for fine-grain scheduling. The popular answer, a user-level stack such as mTCP, removes kernel crossings but loses protection: a buggy application can corrupt the stack and, for example, send raw packets. RDMA needs special adapters at both ends.

IX proposes to break what the authors call a 4-way tradeoff between throughput, latency, protection and resource efficiency. It borrows from middleboxes (firewalls, software routers), which already run each packet to completion and avoid cross-core synchronization, but extends the idea to untrusted general-purpose applications. Each dataplane runs one application in one address space, as in the [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management), but with memory isolation from virtualization hardware.

## Contribution

The paper states four design principles.

- **Separation and protection of control and data plane.** The control plane (the full Linux kernel plus a user program, IXCP) configures, provisions and schedules resources among dataplanes coarsely: whole cores, 2MB pages, NIC queues. Dune puts Linux in VMX root ring 0, dataplanes in VMX non-root ring 0 and applications in ring 3, giving three-way isolation.
- **Run to completion with adaptive batching.** Each stage for a packet batch runs in the dataplane kernel, then the application runs in user mode. Batching never waits and only happens under congestion, with an upper bound on the batch.
- **Native, zero-copy API with explicit flow control.** Batched system calls and event conditions in shared arrays, not POSIX. Incoming mbufs are mapped read-only to the application.
- **Flow-consistent, synchronization-free processing.** NIC receive-side scaling hashes flows to queues, each owned by one hardware thread with its own memory pools, and the API is commutative between elastic threads.

The user-level library libix offers a libevent-like interface so existing applications can be ported.

## Methodology

The dataplane is 39K SLOC: 41% derived from the DPDK variant of the Intel NIC driver, 26% from lwIP, 15% from the Dune library and about 7K of new code. lwIP's data structures were changed for multicore scalability and fine-grained timers (down to 16 microseconds), but its code was not tuned for speed. It requires Intel VT-x and Intel 82599 NICs.

The testbed is 24 clients and one server (Xeon E5-2665, 256 GB) behind a 48-port 10GbE switch, with the server on one 10GbE port or four bonded ports (4x10GbE). Baselines are Linux 3.16.1 and mTCP (on Linux 2.6.36, only at 10GbE, since it lacks NIC bonding). IX uses a maximum batch size of B = 64. Experiments are NetPIPE (single flow), the echo benchmark of MegaPipe and mTCP (cores, messages per connection, message size), a connection-count sweep up to 250,000 connections, and memcached 1.4.18 driven by mutilate with the Facebook ETC and USR workloads, comparing against a tuned Linux with 8 cores versus 6 for IX.

## Findings

All numbers are the authors' own, TCP only.

- **Latency (NetPIPE, 10GbE).** One-way latency for 64B messages is 5.7 microseconds with two IX servers versus 24 with Linux. IX reaches 5 Gbps goodput with 20KB messages, Linux needs 385KB. mTCP has higher latency than both.
- **Throughput.** IX saturates 10GbE with 3 cores, mTCP needs all 8. With 1024 round trips per connection, IX delivers 8.8 million messages per second: 1.9x mTCP and 8.8x Linux. The introduction says up to 10x over Linux and 1.9x over mTCP.
- **4x10GbE.** IX scales linearly to 3.8 million TCP connections per second, 2.3x its 10GbE rate with n = 1 and 1.3x with n = 1024. It delivers 8KB messages at 34.5 Gbps goodput (37.9 Gbps on the wire, of 39.7 possible).
- **Connections.** Up to 250,000 connections, at which IX keeps 47% of its peak, attributed to L3 cache misses (25 per message versus 1.4 at 10,000 connections).
- **memcached.** Kernel time drops from about 75% to under 10%. At a 500 microsecond 99th percentile SLA, throughput is 1550K versus 550K requests per second for ETC (2.8x) and 1800K versus 500K for USR (3.6x). Unloaded 99th percentile latency is 45 vs 94 microseconds (ETC) and 32 vs 85 (USR).
- **Batching.** At low load B does not change tail latency, and raising B from 1 to 16 improves throughput by 29%.

## Critical Analysis

The paper does not claim IX is better than every user-level design. It argues (in its Discussion) that run to completion, adaptive batching and zero-copy could also be built in a user-level stack, and that Dune's protection crossings cost about one L3 cache miss. The case for the kernel is protection, not raw speed.

Limits stated by the authors or visible in the setup:

- The prototype does not use an IOMMU, so the dataplane is trusted code that sees host-physical descriptor addresses. It does not use SR-IOV and supports one NIC family. Application code stays isolated.
- Elastic threads must not block, and a timeout (e.g. 10ms) only flags non-responsive applications to the control plane.
- The IXCP policies for dynamic resource allocation were not built. Only static configurations were tested, so the resource efficiency goal is not evaluated.
- memcached gains were limited by lock contention in the application, which stops scaling past 6 cores. Linux clients were used, and every comparison is to the 2014 stack on 10GbE.
- Porting needs a new API or the libix compatibility layer, with the extra copy.

Later literature, not read for this analysis beyond the catalog entries: the paper itself describes Arrakis as the closest concurrent system (it uses Barrelfish as control plane and supports IOMMUs and SR-IOV). The catalog entries on [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) (2021) and [Snap](/papers/snap-microkernel-approach-to-host-networking) (2019) pursue related goals with different structures. ZygOS and Shenango are not covered here because their texts were not read. The [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems), which the paper cites as the control plane of Arrakis (Barrelfish), is the catalog's other OS design built around per-core state. A longer ACM TOCS version (2016) exists as a separate item and was not read.

## Further Research

- Control-plane policies: dynamic rebalancing of flows among elastic threads under throughput and latency constraints, and energy proportionality.
- IOMMU and SR-IOV support to shrink the trusted code base.
- Congestion control for low-buffer deployments (DCTCP, ECN) paired with IX.
- Non-TCP protocols and persistent-memory access on the same dataplane design.
- Library support for other APIs (MegaPipe, cooperative threading, rule-based models) on the low-level interface.

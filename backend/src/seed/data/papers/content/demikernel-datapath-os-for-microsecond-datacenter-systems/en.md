---
title: "The Demikernel Datapath OS Architecture for Microsecond-scale Datacenter Systems"
summary: A portable datapath operating system for kernel-bypass devices that gives microsecond-scale applications one API and nanosecond-scale overheads.
researchArea: Operating Systems
keywords: operating system, kernel bypass, datacenters, libos
version: 1.1
updatedAt: 2026-10-31
---

## Overview

Datacenter networks, disks and in-memory systems now respond in a few microseconds, so the operating system on the I/O path has to cost nanoseconds. Kernel-bypass devices remove the kernel from the datapath, but they leave applications without the operating system services they used to get: networking and storage stacks, memory management and CPU scheduling.

This SOSP 2021 paper from Microsoft Research and several universities proposes Demikernel, a datapath operating system and architecture for that gap.

## Contribution

Demikernel defines three things.

- **New datapath OS features** for microsecond-scale applications: coordination of zero-copy memory between the application and the device, a DMA-capable heap, and use-after-free protection.
- **PDPIX**, a portable datapath API built around I/O queues and asynchronous completions (queue descriptors and qtokens), in place of files and sockets with blocking calls.
- **A library-OS architecture**, with interchangeable libOSes that run next to a legacy kernel used only for the control path, each offloading to its device when it can and implementing the rest in a userspace library.

## Methodology

The authors built two prototype datapath operating systems, for Linux and Windows, with libOSes for RDMA, DPDK, SPDK and POSIX (the libOS names include Catnap, Catmint, Catnip and Cattree). The implementation is mostly in Rust. It includes a zero-copy TCP stack designed for nanosecond-scale costs, a memory allocator aware of kernel-bypass devices, and coroutine-based scheduling of I/O processing and application work on a single thread.

The evaluation ports existing microsecond-scale systems and applications to PDPIX and measures the cost compared to using the kernel-bypass APIs directly.

## Findings

These are the authors' reported results.

- Applications ported to Demikernel run across different kernel-bypass devices with no code changes.
- The datapath adds about 50 ns of I/O processing latency per I/O.
- Peak throughput overhead is 17 to 26% compared to directly using kernel-bypass APIs.
- The authors report that building and porting applications took little effort.

## Critical Analysis

Demikernel is a convincing answer to a real gap, and the paper is open about its scope.

Points to read carefully:

- The common API hides device-specific features, so it does not suit workloads that need them directly, such as one-sided RDMA, high-performance computing or software middleboxes. The authors say this themselves.
- Scheduling is cooperative, so applications must run in a tight I/O loop and enter the libOS at least once every millisecond. Failing to give the datapath OS cycles can cause dropped packets and missing acknowledgements.
- The 17 to 26% throughput overhead is the price of portability, and the paper's measure depends on which applications and devices were tested.
- Zero-copy and use-after-free protection depend on the Demikernel memory allocator, which the authors present as a trade-off for applications that want to use their own.

## Further Research

- Scheduling that balances I/O processing and application work when requests are long or highly varied.
- Supporting more device features through the common API without losing portability.
- Multicore scaling: the libOSes are single threaded and the authors say they do not yet know whether avoiding shared state across cores will be a major limitation.

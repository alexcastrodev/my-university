---
title: "Arrakis: The Operating System is the Control Plane"
summary: Arrakis splits the kernel's job in two. The kernel keeps the control plane and configures virtualized NICs and storage controllers, while applications reach the hardware directly through a user-level library, and the authors report 2-5x lower latency and 9x higher throughput for Redis than a tuned Linux.
researchArea: Operating Systems
keywords: Arrakis, kernel bypass, control plane, data plane, SR-IOV, library OS, virtual storage areas, Barrelfish
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Recent device hardware trends enable a new approach to the design of network server operating systems. In a traditional operating system, the kernel mediates access to device hardware by server applications, to enforce process isolation as well as network and disk security. We have designed and implemented a new operating system, Arrakis, that splits the traditional role of the kernel in two. Applications have direct access to virtualized I/O devices, allowing most I/O operations to skip the kernel entirely, while the kernel is re-engineered to provide network and disk protection without kernel mediation of every operation. We describe the hardware and software changes needed to take advantage of this new abstraction, and we illustrate its power by showing improvements of 2-5x in latency and 9x in throughput for a popular persistent NoSQL store relative to a well-tuned Linux implementation.

## Overview

By 2014 a key-value server spent much of its time in kernel code (interrupts, packet demultiplexing, copies, file system metadata) to do a lookup that takes microseconds. Decades of work on faster kernel paths had not closed the gap to the raw hardware. This OSDI 2014 paper, from the University of Washington and ETH Zurich (it received the conference's best paper award, per the USENIX page), asks what happens if the kernel leaves the data path for nearly all I/O while keeping the protection model of a conventional OS.

It sits in a lineage the catalog already covers. The [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) argued for application-level resource management, though the paper notes that Exokernel, like SPIN and Nemesis, still mediated I/O in the kernel. Arrakis is built on a fork of Barrelfish, the OS of [The Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems), because Barrelfish already provides a library OS and user-level drivers. [Xen](/papers/xen-and-the-art-of-virtualization) matters as the origin of the hardware setting: SR-IOV was built so virtual machines could share one device.

Worth knowing first: the control plane and data plane split, DMA descriptor rings, and what an IOMMU does. The later [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) paper is discussed under Critical Analysis.

## Contribution

- **A division of labor.** Hardware multiplexes and protects, the kernel configures, a user-level library implements the I/O stack. Installing filters, rate limits and storage mappings stays privileged and goes through the kernel (the control plane); sending, receiving and storing do not.
- **An ideal device model.** Virtual interface cards (VNICs for networks, VSICs for storage) with their own queues, plus transmit and receive filters, rate limiters and virtual storage areas (VSAs). The model is deliberately limited to what hardware can do efficiently, so filters are less expressive than OpenFlow rules and have no priority-based overlapping matches.
- **Emulation where hardware falls short.** A dedicated core emulates the VSIC for a RAID controller that lacks SR-IOV and VSAs.
- **Two interfaces.** Arrakis/P keeps POSIX sockets and files for unmodified applications. Arrakis/N is a native asynchronous interface with true zero-copy I/O.
- **Caladan**, a library of persistent logs and queues that store metadata with each entry so an append needs one hardware write. It is unrelated to the later scheduler of the same name.

## Methodology

Arrakis adds 33,786 lines to Barrelfish: SR-IOV support, drivers for the Intel 82599 10G NIC (physical and virtual function), the Intel IOMMU and the Intel RS3 RAID controller, the Extaris user-level stack (partly based on lwIP), and missing POSIX pieces such as threads and epoll. Tests ran on six Xeon E5-2430 machines with a 10Gb switch against Linux 3.8, tuned with a newer ixgbe driver and RSS disabled for single-core runs. Workloads: a UDP echo server with 1KB packets, memcached 1.4.15 (90% fetch, 10% store, 1KB values), Redis 2.8.5 with each SET persisted, haproxy 1.4.24 behind ApacheBench, a raw-IP load-balancing middlebox, and a rate-limiting test with five memcached instances.

The protection model: filters and VSA mappings are kernel-protected capabilities. The transmit filter stops an application from spoofing addresses or VLAN tags, the receive filter decides which packets reach which queue, and the IOMMU confines DMA to the application's memory. Names stay global: an application exports file names to the kernel VFS, which treats them like remote mount points. Other programs read them through a library file server in the owning application, by mapping the VSA, or through an export.

## Findings

These are the authors' reported results.

- **Where Linux spends time.** Of 3.36 microseconds per UDP packet, nearly 70% is network stack. Arrakis/P cuts server-side overhead to 1.44 microseconds (57% less), Arrakis/N to 0.38.
- **Echo throughput.** Arrakis/P reaches 2.3x Linux with no application work and Arrakis/N 3.9x, 94% of a driver-embedded echo server. The benefit disappears at 64 microseconds of processing per packet.
- **Memcached.** On one core Arrakis/P gets 1.7x Linux throughput and nears line rate at 4 cores, while Linux nearly plateaus past two. Changing 74 lines for Arrakis/N adds 9% (receive) and 10% (send). The paper reports throughput here, not latency.
- **Redis latency.** Table 2 shows read hits falling from 8.67 to 4.07 microseconds (2x) and durable writes from 163.14 to 31.51 (about 5x, 99th percentile 188.67 to 35.76). Arrakis write latency is dominated by the 25 microsecond storage access.
- **Redis throughput.** Write throughput rises 9x using Caladan (109 lines changed). A simulated 15 microsecond device adds another 1.6x. Caladan on Linux's network stack gets only 5x, so both virtualizations matter.
- **Other servers.** haproxy gains 2.2x (2x against Linux's speculative epoll), and the middlebox 2.6x, where Linux does not scale at all.
- **Isolation.** Rate specifiers limited one of five memcached instances to 100Mb/s, as Linux queuing disciplines did.

## Critical Analysis

The paper states its own caveats. Its Linux baseline lacks features that Arrakis does not yet support (cache direct access, segmentation and receive offloads), so it says the comparison favors Linux. The RAID controller gives no capability protection of logical disks, and the 82599 filters only on MAC and VLAN, so software filtering fills in. Only 64 virtual interfaces were available, and the six-core points are affected by Barrelfish background activity.

The following is a reading of the evidence, not claims of the paper.

- **The text and Table 2 disagree.** Section 4.4 says Redis write latency improves by 63%, while the abstract and Table 2 give about 5x. I treated the table as the measurement.
- **Not every headline is measured.** There is no experiment with a virtualized guest or with virtualized IPIs (both only discussed), and no memcached latency curve. A library file server is described, but no benchmark evaluates it.
- **Hardware assumptions carry weight.** The best numbers rely on the ideal device model, an emulated storage path, and one workload that was modified to use Caladan.

Later literature, flagged as such. The [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) paper (SOSP 2021, read) calls Arrakis and IX kernel-bypass architectures that are not portable, especially to virtualized environments, because they leverage SR-IOV, and says Arrakis's architecture does not flexibly support heterogeneous devices. That is Demikernel's characterization. I did not read IX, DPDK, SPDK or later bypass work.

## Further Research

- Hardware filters on application-level properties, which the paper names as an open question.
- Hardware access control for interrupts between cores of one application.
- Running Arrakis as a guest by moving the control plane into the VMM.
- Whether the native interface gains hold for applications with more complex I/O patterns than memcached.
- A catalog page on [Trio](/papers/trio-high-performance-and-secure-userspace-nvm-file-systems) says it takes secure direct access from Exokernel and Arrakis (I took this from that page, not from Trio's text).

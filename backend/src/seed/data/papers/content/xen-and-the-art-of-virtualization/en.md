---
title: "Xen and the Art of Virtualization"
summary: The Cambridge group presents Xen, an x86 hypervisor that runs several commodity operating systems side by side by paravirtualizing them (a modified guest kernel, an unmodified application interface), and reports overheads of at most a few percent against native Linux on the benchmarks it measured.
researchArea: Operating Systems
keywords: xen, virtualization, hypervisor, paravirtualization, virtual machine monitor, i/o rings, performance isolation
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Numerous systems have been designed which use virtualization to subdivide the ample resources of a modern computer. Some require specialized hardware, or cannot support commodity operating systems. Some target 100% binary compatibility at the expense of performance. Others sacrifice security or functionality for speed. Few offer resource isolation or performance guarantees; most provide only best-effort provisioning, risking denial of service.

This paper presents Xen, an x86 virtual machine monitor which allows multiple commodity operating systems to share conventional hardware in a safe and resource managed fashion, but without sacrificing either performance or functionality. This is achieved by providing an idealized virtual machine abstraction to which operating systems such as Linux, BSD and Windows XP, can be ported with minimal effort.

Our design is targeted at hosting up to 100 virtual machine instances simultaneously on a modern server. The virtualization approach taken by Xen is extremely efficient: we allow operating systems such as Linux and Windows XP to be hosted simultaneously for a negligible performance overhead, at most a few percent compared with the unvirtualized case. We considerably outperform competing commercial and freely available solutions in a range of microbenchmarks and system-wide tests.

## Overview

The paper appeared at SOSP 2003 (Bolton Landing, New York), from the University of Cambridge Computer Laboratory. It sits in the revival of virtual machine monitors in the early 2000s, when the goal was to run many mutually untrusting operating system instances on one cheap x86 server, for hosting and server consolidation. The authors' own deployment target was the XenoServer project, an Internet-scale platform where users pay for the resources of the virtual machine they start.

The problem is that x86 was not designed for classical virtualization. Some privileged instructions fail silently instead of trapping, and the hardware-walked page table is hard to virtualize. The paper describes VMware's ESX Server as handling this by dynamically rewriting guest kernel code and keeping shadow page tables. Xen takes the other road, which the paper calls paravirtualization: present a virtual machine that is similar but not identical to the hardware, so the guest kernel is ported while applications are not.

Key terms: the hypervisor is Xen itself, a domain is a running virtual machine, and Domain0 is the first domain, which hosts the management software. Worth knowing first: protection rings, hardware page tables and the TLB, and what a system call and a page fault cost. Pairings below are mine, the 2003 paper cannot cite them. [A virtual firmware monitor](/papers/virtual-firmware-monitor-design-and-implementation) applies the opposite recipe (trap and emulate an unmodified guest) to RISC-V firmware. [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems) is the older vocabulary for the question of who may touch what. The paper itself builds on Exokernel and Nemesis for the idea of multiplexing at a low level, and contrasts itself with Denali.

## Contribution

- **Paravirtualization as the design choice.** Four principles: unmodified application binaries are essential, full multi-application operating systems must be supported, paravirtualization is necessary for performance and isolation on x86, and completely hiding virtualization from the guest risks correctness and performance.
- **A virtual x86 interface (Table 1).** The guest runs in ring 1 under Xen in ring 0, registers its exception handlers and an optional fast system call handler, and sees real as well as virtual time.
- **Memory without shadow tables.** Guest page tables are registered directly with the MMU, mapped read-only, and updates go through hypercalls that Xen validates. Each frame has a type (page directory, page table, descriptor table or writable) and a reference count. Xen lives in 64MB at the top of every address space to avoid a TLB flush on entry.
- **Hypercalls and events.** Synchronous calls go from the domain to Xen, and asynchronous notifications go back as events in a per-domain bitmask.
- **Asynchronous I/O rings.** Shared-memory rings of descriptors, with out-of-band buffers, request and response pointers, and no ordering requirement.
- **Control and management split.** Domain0 builds domains, sets the virtual network interfaces and virtual block devices, and holds the policy, while the hypervisor keeps only mechanisms.
- **A balloon driver in XenoLinux**, attributed to the VMware ESX Server paper, that adjusts a domain's memory through the guest's own page allocator.

## Methodology

The system is a hypervisor plus XenoLinux, a port of Linux 2.4.21. Windows XP and NetBSD ports were in progress and are not evaluated. Section 4 compares native Linux, XenoLinux, VMware Workstation 3.2 and User-mode Linux (the skas3 variant) on a Dell 2650 with two 2.4GHz Xeons, 2GB of RAM, a gigabit NIC and one SCSI disk. Hyperthreading was off, the guests had one CPU, and the results are medians of seven trials (nine for the network tests).

The workloads are SPEC INT2000, a Linux kernel build, PostgreSQL 7.1.3 under OSDB (information retrieval and OLTP), dbench, SPEC WEB99 with Apache, 37 lmbench microbenchmarks, ttcp over gigabit Ethernet, and then multi-domain runs: up to 16 SPEC WEB99 instances, up to 8 OSDB instances, a mix with two hostile domains, and up to 128 domains running SPEC CINT2000. VMware ESX Server was measured but, as the paper says, its license forbids publishing the numbers.

## Findings

All numbers below are the paper's, from one machine, Linux 2.4 and the benchmarks above.

- **Single-OS benchmarks (Figure 3), native Linux versus XenoLinux.** SPEC INT2000 567 and 567; Linux build 263 s and 271 s; OSDB-IR 172 and 158 tup/s; OSDB-OLTP 1714 and 1633 tup/s; dbench 418 and 400; SPEC WEB99 518 and 514. The text says XenoLinux is within 1% on SPEC WEB99, while VMware and UML support less than a third of the clients (150 and 172 in the figure). In the build, Xen's system-time overhead is 3%. VMware Workstation scores 334 s on the build, 80 on OSDB-IR, 199 on OSDB-OLTP and 310 on dbench; UML scores 535 s, 65, 306 and 111.
- **Microbenchmarks.** In 24 of 37 lmbench tests XenoLinux is similar to native. Fork, exec and sh are slower (fork 198 µs against 110 µs for uniprocessor Linux), which the paper attributes to page table updates that Xen must validate. Batching lets one hypercall carry up to 2048 updates, which build 8MB of address space.
- **Network.** At an MTU of 1500, ttcp gives 897 Mb/s for Linux and for Xen in both directions, against 291 sent and 615 received on VMware and 165 and 203 on UML. At an MTU of 500 Xen loses 14%.
- **Concurrent domains.** On two CPUs native Linux reaches 662 conformant SPEC WEB99 clients with one Apache; a single Xen domain improves its own single-CPU score by 9%, and with more domains Xen gets within a few percent. Several PostgreSQL instances on one Linux score 25 to 35% below the same instances in separate domains, and the paper says the cause is not fully understood.
- **Isolation.** With two hostile domains running a disk hog, a fork bomb and a memory hog, OSDB-IR and SPEC WEB99 fall 4% and 2%. On native Linux the machine became unusable for the two benchmarks.
- **Scalability.** A domain shrinks to 6.2MB of memory (4.2MB with swap), and Xen keeps 20kB of state per domain. With 128 compute-bound domains throughput falls 7.5%; with a 50 ms slice instead of 5 ms the gap almost vanishes, at a cost to interactivity. UDP latency to a busy domain averaged 147 ms (standard deviation 97) against 5.4 ms for an idle 129th domain.
- **Porting cost (Table 2).** 2995 lines modified or added for Linux (1.36% of the x86 code base) and 4620 for Windows XP (0.04%), the latter without virtual device drivers.

## Critical Analysis

The central claim, paravirtualization avoids the cost of faking the hardware, is supported by a careful, multi-benchmark evaluation. Limits the paper itself states or leaves open:

- **No numbers for the strongest commercial competitor.** ESX Server is only described, not measured in print, so "noticeably outperform ESX Server" cannot be checked from the paper.
- **Guests need modified kernels.** The paper calls the Windows XP port incomplete, with no virtual I/O drivers yet, so the generality claim for closed-source systems rests on partial work.
- **Guests are single-CPU, and the paper says so.** It lists the missing SMP guest support as a handicap in one result, and uses one-CPU configurations for most.
- **Isolation is shown by one experiment,** with two hostile domains, and the disk scheduler is described as simple. There is no security analysis or attack study, and Domain0 is trusted.
- **Migration is not part of this paper.** It cites suspend and migration work only as motivation for application mobility; it describes no live migration.
- **Everything is 2003:** Linux 2.4, one Xeon server, RedHat 7.2.

Later literature (not part of this paper). Adams and Agesen (ASPLOS 2006, VMware, checked in a course-hosted copy) report that after Intel and AMD added hardware support for classical virtualization, a hardware-assisted VMM often performed worse than VMware's software VMM, because the hardware offered no MMU virtualization; they also note that paravirtualization gains performance but gives up legacy and proprietary operating systems. Firecracker (NSDI 2020, AWS, checked in the USENIX PDF) keeps KVM and replaces QEMU, and mentions that some earlier lightweight-VM projects slimmed down Xen; one of its authors, Rolf Neugebauer, is also an author of this paper.

## Further Research

- Hardware-assisted virtualization and MMU support: when does it beat paravirtualization, and when does a paravirtual device interface still pay off.
- Stronger performance isolation, including disk and network scheduling, which the authors name as future work.
- The planned extensions in the paper: a shared block cache, copy-on-write virtual block devices, a last-chance page cache and accounting for XenoServers.
- Smaller trusted bases than a full Domain0, and minimal VMMs for short-lived, high-density workloads, as in Firecracker.
- Reproducing the comparison on modern hardware and kernels.

---
title: "Memory Resource Management in VMware ESX Server"
summary: Waldspurger describes how VMware ESX Server overcommits memory among virtual machines running unmodified guest operating systems, combining ballooning, content-based page sharing, an idle memory tax on proportional shares, and hypervisor paging as the fallback.
researchArea: Operating Systems
keywords: vmware esx server, memory overcommitment, ballooning, content-based page sharing, idle memory tax, proportional-share allocation, hypervisor paging
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

VMware ESX Server is a thin software layer designed to multiplex hardware resources efficiently among virtual machines running unmodified commodity operating systems. This paper introduces several novel ESX Server mechanisms and policies for managing memory. A ballooning technique reclaims the pages considered least valuable by the operating system running in a virtual machine. An idle memory tax achieves efficient memory utilization while maintaining performance isolation guarantees. Content-based page sharing and hot I/O page remapping exploit transparent page remapping to eliminate redundancy and reduce copying overheads. These techniques are combined to efficiently support virtual machine workloads that overcommit memory.

## Overview

The paper appeared at OSDI 2002 (Boston, December 9-11), from VMware. It sits in the server consolidation wave of the early 2000s: many lightly used servers become virtual machines on one host, and the administrator wants to overcommit memory, meaning the memory configured for all VMs adds up to more than the machine has. The hard part is that ESX Server ran unmodified Windows 2000 and Red Hat Linux 7.2, so it could not ask the guest what it was doing with its pages. The best knowledge about which page is least valuable lives inside the guest.

Key terms: a "physical" page number (PPN) is what the guest thinks is hardware, and a machine page number (MPN) is the real frame; ESX keeps a pmap per VM and shadow page tables. Worth knowing first: demand paging, page replacement, copy-on-write and TLBs. Pairings below are mine. [Xen](/papers/xen-and-the-art-of-virtualization) (SOSP 2003) takes the opposite road, a modified guest, and its balloon driver is credited to this paper. [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) is the other classic on who decides about physical pages. [The Slab Allocator](/papers/slab-allocator-object-caching-kernel-memory-allocator) is the kind of guest kernel allocator whose pressure ballooning triggers, though this paper does not mention it. The paper itself builds on Disco, Cellular Disco and Nemesis, none of which is in the catalog.

## Contribution

- **Ballooning.** A small module loaded in the guest as a pseudo-device driver. The server tells it to inflate (allocate pinned guest pages) or deflate, so the guest's own replacement policy picks the victims, paging to its own virtual disk if needed.
- **Content-based page sharing.** Pages are identified by a hash of their contents, then verified by full comparison, then mapped copy-on-write. No guest changes, unlike the hooks Disco needed.
- **Idle memory tax.** Min-funding revocation is extended with an adjusted shares-per-page ratio, rho = S / (P (f + k (1 - f))), where k = 1/(1 - tau). An idle page costs k times an active one.
- **Statistical working-set estimation.** Random sampling of a few pages per VM, with no guest involvement, feeds the tax.
- **A dynamic allocation policy.** Parameters min, max and shares, admission control, four free-memory thresholds, ballooning first and paging as the fallback.
- **Hot I/O page remapping**, which moves pages used in repeated I/O out of high memory to avoid bounce-buffer copies on large-memory IA-32 systems.

## Methodology

The system is ESX Server 1.5 on IA-32. The evaluation uses small experiments on several machines: a dual 800 MHz Pentium III Dell Precision 420 for ballooning, sampling and the tax; a dual 933 MHz Dell PowerEdge 1400SC for page sharing; an eight-way 550 MHz IBM Netfinity 8500R for dynamic reallocation. Workloads are dbench with 40 clients, SPEC95 in identical Linux VMs, a Windows toucher program, and a five-VM Windows 2000 mix (Exchange, Citrix MetaFrame, SQL Server). Sharing is also measured on three production deployments. There are no comparisons to other VMMs and no variance bars beyond a three-run average for ballooning.

## Findings

All numbers below are the paper's own.

- **Ballooning versus a VM configured smaller (Figure 2).** A 256 MB Linux VM ballooned down tracks a VM configured at that size, with overhead from 4.4% at 128 MB (128 MB balloon) down to 1.4% at 224 MB. The paper attributes it to guest data structures sized by "physical" memory. The paper does not run a head-to-head of ballooning against ESX paging; it only says ballooning is preferred and paging is the fallback.
- **Page sharing, best case (Figure 4).** Identical Red Hat 7.2 VMs of 40 MB running SPEC95, one to ten at a time. Sharing approaches 67% of VM memory and nearly 60% is reclaimed. One VM already yields nearly 5 MB, about 55% zero pages. Throughput with sharing was 0.5% higher over all runs (range 1.6% lower to 1.8% higher). Sharing metadata costs under 0.5% of memory.
- **Page sharing in production (Figure 5).** Ten Windows NT VMs, 2048 MB: 880 MB shared (42.9%), 673 MB reclaimed (32.9%). Nine Linux VMs, 1846 MB: 539 MB (29.2%) and 345 MB (18.7%). Five Linux VMs, 1658 MB: 165 MB (10.0%) and 120 MB (7.2%). The paper says more diverse workloads show less sharing.
- **Idle memory tax (Figure 7).** Two VMs with equal shares and 256 MB each, one idle Windows and one dbench Linux. At tau = 0% both settle at 179 MB. Raising tau to 75% (the default) moves memory from the idle VM and raises dbench throughput by over 30%. The sampler defaults to 100 pages per 30 seconds.
- **Dynamic reallocation (Figure 8).** Five VMs on 1 GB of usable memory, configured for 1472 MB plus 160 MB of overhead, overcommitted by more than 60%. During boot, 325 MB of zero pages are reclaimed by sharing while 35 MB is written to disk, and later less than 20 MB is swapped. Sharing saves about 200 MB over the run, and the SQL Server VM drops to its 160 MB min when idle.
- **I/O remapping.** For some network-intensive workloads the number of pages copied falls by several orders of magnitude; the paper gives no table for it.

## Critical Analysis

The central design is persuasive: pick the guest's own policy when possible (ballooning), use content hashing when the guest cannot cooperate, and keep paging as a rare safety net. Limits and gaps in the paper itself:

- **Small, single-vendor experiments.** One machine per experiment, short runs, and no comparison with another hypervisor.
- **Best-case sharing.** The 67% figure is for identical Linux VMs; the production cases range from 7.2% to 32.9% reclaimed.
- **The tax is a heuristic with a global default.** tau = 75% applies to every VM, and the paper says per-VM rates exist in the implementation but are not exposed.
- **Ballooning has known limits, stated by the paper:** the driver may be uninstalled, unavailable while the guest boots, or too slow, which is why paging exists. During the five-VM boot, paging was forced for exactly that reason.
- **Not claimed:** no security analysis of page sharing, no measurement of the double-paging problem it describes, no live migration, no memory compression.

Later literature (not part of this paper, checked in the sources named). VMware's knowledge base (article 2080735) says that out of caution ESXi update releases no longer enable inter-VM page sharing by default, and that it is not enabled by default as of ESXi 6.0; the article cites no research. VMware's vSphere 8.0 performance best practices state that ESXi does not share 2 MB large pages, so with large pages sharing might not happen until overcommitment is high enough. The Linux kernel documentation describes KSM (since 2.6.32, originally developed for KVM) as scanning memory registered with madvise(MADV_MERGEABLE) and merging only anonymous pages. The Firecracker paper (NSDI 2020) lists memory deduplication without losing side-channel isolation as an open direction, and the Firecracker repository documents a virtio balloon device with deflate-on-OOM and free page reporting. A hot-add path was only a future idea here (pluggable memory cards); I did not check later work on it, and I did not read the 2015 VMware paper on proactively breaking large pages, which I only saw in a search listing.

## Further Research

- When page sharing is worth its side-channel risk, and how to share without a cross-tenant timing signal.
- Reconciling large pages (fewer TLB misses) with sharing and overcommitment.
- Better idleness estimators than 100 random pages per 30 seconds, and per-VM or graduated tax rates, which the authors suggest.
- Multi-resource tradeoffs, higher-level grouping of VMs, and feedback-driven workload management, all listed in the paper's conclusions.
- Guest-cooperative memory interfaces (hot-pluggable memory, free page reporting) for microVMs and containers.

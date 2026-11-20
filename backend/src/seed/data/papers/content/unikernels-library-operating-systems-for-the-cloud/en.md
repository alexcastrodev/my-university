---
title: "Unikernels: Library Operating Systems for the Cloud"
summary: Madhavapeddy and colleagues at Cambridge propose compiling an application, a language runtime and OS libraries into a single sealed, single-address-space image that boots directly on Xen, and build the OCaml-based Mirage prototype to show a DNS server, an OpenFlow controller and web appliances with images from kilobytes to a few hundred kilobytes and performance near or above Linux, BIND and Apache.
researchArea: Operating Systems
keywords: unikernel, library operating system, Mirage, OCaml, Xen, hypervisor, dead-code elimination, single address space
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

We present unikernels, a new approach to deploying cloud services via applications written in high-level source code. Unikernels are single-purpose appliances that are compile-time specialised into standalone kernels, and sealed against modification when deployed to a cloud platform. In return they offer significant reduction in image sizes, improved efficiency and security, and should reduce operational costs. Our Mirage prototype compiles OCaml code into unikernels that run on commodity clouds and offer an order of magnitude reduction in code size without significant performance penalty. The architecture combines static type-safety with a single address-space layout that can be made immutable via a hypervisor extension. Mirage contributes a suite of type-safe protocol libraries, and our results demonstrate that the hypervisor is a platform that overcomes the hardware compatibility issues that have made past library operating systems impractical to deploy in the real-world.

## Overview

In a virtual-machine cloud, each VM is usually specialised to one role (a database, a web server), but the image still boots a general-purpose kernel and runs unmodified application processes. The authors say there is little actual specialisation in what is deployed, and that a typical appliance carries several hundred thousand, if not millions, of lines of active code that run on every boot, plus services that a misconfiguration can leave exposed.

The paper (ASPLOS '13, Cambridge, Nottingham, Citrix and OCamlPro) takes the library OS idea of the [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) and moves it onto a hypervisor. Its argument is that library OSs were never widely deployed because of hardware support, and that [Xen](/papers/xen-and-the-art-of-virtualization) already provides virtual devices, so the hypervisor's drivers can be reused. The paper adopts the [Multikernel](/papers/multikernel-new-os-architecture-scalable-multicore-systems) philosophy of one VM per core, and notes that the hypervisor can still overcommit memory between VMs (the mechanism [ESX Server](/papers/memory-resource-management-in-vmware-esx-server) describes in detail).

Worth knowing first: what a hypervisor and a paravirtual device ring are, what a library OS is, and a little OCaml (static types, cooperative threads). Pairings below are mine and are not cited by the paper: for the same instinct of removing the kernel from the I/O path, see [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) and [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems); for fast-booting small VMs in production, see [Firecracker](/papers/firecracker-lightweight-virtualization-for-serverless-applications).

## Contribution

- **The unikernel.** A specialised, sealed, single-purpose library OS VM that runs directly on the hypervisor. The scheduler, the device drivers and the network stack are libraries linked with the application, and configuration is part of compilation, so the module dependency graph can be checked statically to contain only the wanted services.
- **Mirage.** A complete OCaml prototype: the PVBoot start-of-day library, a modified OCaml runtime, type-safe Xen device drivers, and protocol libraries (Table 1: Ethernet, ARP, DHCP, IPv4, ICMP, UDP, TCP, OpenFlow, DNS, SSH, HTTP, XMPP, SMTP, a FAT-32 library, an append B-tree and others).
- **Sealing.** A special hypercall, added by a Xen 4.1 patch of fewer than 50 lines, that stops further page-table changes once the VM has built page tables where no page is both writable and executable. It is the only part that needs a hypervisor change, and Mirage runs on unmodified Xen without it.
- **Compile-time specialisation.** Whole-system optimisation and dead-code elimination at build time, and address-space randomisation by generating a fresh linker script per compilation instead of at runtime.
- **Evaluation** against Linux, BIND, NSD, NOX, Maestro and Apache on microbenchmarks and four appliances.

## Methodology

Mirage links OCaml code into a bootable Xen image. It can also build POSIX binaries for testing on UNIX (Figure 15: a development target, a posix-direct target, and the xen-direct target). The runtime has one 64-bit address space, with a minor heap in a single 2 MB extent and a major heap that grows in 2 MB superpages. There are no multiple processes and no preemptive threading: Lwt cooperative threads run on a loop that blocks on Xen event channels. Each unikernel has one virtual CPU, and multicore means several unikernels on one Xen, communicating with the vchan shared-memory transport. I/O pages are shared with the backend through Xen grant tables and passed zero-copy to the application via the cstruct extension.

Microbenchmarks compare identical OCaml code as linux-native, linux-pv and xen-direct, and boot time is compared against a minimal Linux kernel and a Debian guest running Apache2. The appliances are compared with Bind 9.9.0 and NSD 3.2.10 (DNS, queryperf, 10 runs), Maestro and the destiny-fast branch of NOX (OpenFlow, cbench on a 16-core AMD server), an nginx, fastCGI and web.py service (a "Twitter-like" dynamic site, httperf) and Apache2 with the mpm-worker backend (a static page). Lines of code are counted with cloc after preprocessing, and the paper warns that LoC comparisons are rarely meaningful.

## Findings

Numbers below are the paper's, from the text unless marked "chart reading".

- **Boot.** With the stock toolstack, Mirage matches the minimal Linux kernel and boots in slightly under half the time of the Debian guest with Apache2. With a parallel domain-construction toolstack the authors modified, Mirage boots in under 50 ms.
- **Threads and I/O.** Creating millions of threads is faster on Xen than on Linux (chart reading), and timer jitter is lower and more predictable. A flood of 10^6 pings costs Mirage a 4 to 10% latency increase over Linux, and both survived a 72-hour flood. With hardware offload disabled, TCP is on par: Linux to Mirage 1742 Mbps and Mirage to Linux 975 Mbps with one flow, against 1590 for Linux to Linux. Block reads match Linux direct I/O, whose buffer cache plateaus near 300 MB/s against 1.6 GB/s without it.
- **DNS.** BIND reaches 55 kqueries/s and NSD around 70. Mirage starts near 40 and reaches 75 to 80 after a 20-line memoization patch, which the introduction rounds to 45% above BIND. The image is 183.5 kB against 462 MB for the Linux VM, and the authors note Mirage does not implement the full feature set.
- **OpenFlow.** Mirage falls between NOX and Maestro (chart reading), with NOX the fastest.
- **Web.** The dynamic appliance scales linearly to about 80 sessions, while the Linux VM tops out near 20. The Linux VM serving one static page via nginx reaches 5,000 requests/s, which the authors say is substantially higher than unoptimised Mirage. Memory is 32 MB against 256 MB. For static pages Mirage exceeds Apache2 in all three Linux configurations (no numbers in the text).
- **Size.** After dead-code elimination the images are 0.184 MB (DNS), 0.172 (web), 0.164 (OpenFlow switch) and 0.168 (controller), from 0.449, 0.673, 0.393 and 0.392. A Linux appliance has at least 4 to 5 times more active lines of code (Figure 14a, roughly 570 thousand for Linux 3.2.2 against 120 thousand for Mirage, chart reading).

## Critical Analysis

The paper states several limits itself. It is OCaml only, and it knowingly gives up source compatibility: rewriting stacks such as TCP is called a "daunting engineering challenge", feasible for a research prototype. Memory is preallocated because a sealed VM cannot grow its heap. The unikernel has no multicore, and the paper says the hypervisor and dom0 stay in the trusted base and in unsafe code. Isolation is whatever the hypervisor gives, and cooperative threading means a single bug can deadlock the entire appliance. The paper also says a VM that uses static configuration cannot be cloned from a copy-on-write snapshot.

What the paper does not claim, and a reader should not infer:

- That the model fits general-purpose applications. It targets network-facing single-purpose appliances and proposes Vchan-linked encapsulated VMs for legacy code only as an idea (section 5.2).
- That the numbers generalise beyond systems the authors configured in known ways. The Linux baselines are stock or Debian images, and the DNS gain comes mostly from an application-level memoization patch. BIND's low result on small zones is reported as unexplained but reproducible.
- That the C libOS route is sound. It reports NSD and BIND built against newlib, lwIP and MiniOS performing poorly, attributed to a select(2) and netfront interaction.

Later literature, which I did not read in full: the catalog entry for [uFork](/papers/ufork-posix-fork-within-a-single-address-space-os) describes the POSIX `fork` gap of single-address-space OSs, which is the same cost the paper accepts when it drops fork and processes. I used only that catalog page, not the uFork PDF.

## Further Research

- The authors list pushing the unikernel below the hypervisor and dom0, which are still unsafe code, and native many-core support.
- Cloud orchestration for tiny VMs: the paper says OpenStack and Eucalyptus show high latency on small VMs and that single-bug deadlocks need broader management.
- Raising the abstraction level with verified or extracted OCaml implementations of RFCs, filesystems and crypto, and verifying the compiler back end or a microkernel.
- Encapsulating existing components (Map-Reduce, Hadoop, Dryad) as VMs with message passing, an incremental route for legacy code.

---
title: "Firecracker: Lightweight Virtualization for Serverless Applications"
summary: Firecracker keeps KVM but replaces QEMU with a minimal Rust VMM that emulates only a few virtio devices, runs one jailed process per microVM, and gives AWS Lambda and Fargate hardware-level isolation with low memory overhead and fast boot.
researchArea: Operating Systems
keywords: microVM, virtual machine monitor, KVM, serverless, virtio, seccomp, jailer, multi-tenancy, memory overhead, boot time
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Serverless containers and functions are widely used for deploying and managing software in the cloud. Their popularity is due to reduced cost of operations, improved utilization of hardware, and faster scaling than traditional deployment methods. The economics and scale of serverless applications demand that workloads from multiple customers run on the same hardware with minimal overhead, while preserving strong security and performance isolation. The traditional view is that there is a choice between virtualization with strong security and high overhead, and container technologies with weaker security and minimal overhead. This tradeoff is unacceptable to public infrastructure providers, who need both strong security and minimal overhead. To meet this need, we developed Firecracker, a new open source Virtual Machine Monitor (VMM) specialized for serverless workloads, but generally useful for containers, functions and other compute workloads within a reasonable set of constraints. We have deployed Firecracker in two publicly-available serverless compute services at Amazon Web Services (Lambda and Fargate), where it supports millions of production workloads, and trillions of requests per month. We describe how specializing for serverless informed the design of Firecracker, and what we learned from seamlessly migrating Lambda customers to Firecracker.

## Overview

This NSDI 2020 paper (all eight authors at Amazon Web Services) starts from a tradeoff. Linux containers (cgroups, namespaces, seccomp-bpf) pack many workloads onto one host, but they share one kernel, so security is bought by restricting syscalls, at the cost of compatibility. Hypervisor virtualization isolates better, but the VMM and guest kernel cost memory and boot time before any useful work happens. The first Lambda isolated functions with containers and customer accounts with VMs, and the authors were unsatisfied with that: it traded security against compatibility and packed workloads badly onto fixed-size VMs.

The paper lists six criteria for a replacement: isolation, overhead and density, performance, compatibility (arbitrary Linux binaries, unmodified), fast switching and soft allocation (overcommit). It compares containers, language-VM isolation and virtualization, and picks virtualization. It places the decision in the line of [Xen](/papers/xen-and-the-art-of-virtualization), which it cites as a hypervisor option and which shares an author, Rolf Neugebauer, with this paper. The motivation resembles that of the [Exokernel](/papers/exokernel-os-architecture-application-level-resource-management) and [seL4](/papers/sel4-formal-verification-of-an-os-kernel) (shrink what must be trusted), but the paper cites neither; it cites Muen and NOVA as earlier minimized hypervisors that lacked the platform independence, operations and maturity AWS needed.

## Contribution

The contribution is a design, an open source implementation (Apache 2, released December 2018) and operating experience, not a new algorithm.

- **Keep KVM, replace QEMU.** QEMU has more than 1.4 million lines, supports more than 40 emulated devices and can need up to 270 syscalls; KVM adds about 120,000 lines. Firecracker is about 50k lines of Rust (96% fewer than QEMU), started from Google's crosvm and has fewer than half its lines.
- **Minimal device model.** Network and block devices through virtio, serial ports and partial i8042 support. The virtio block code is about 1400 lines. Storage is a block device, not filesystem passthrough, to keep a large code base out of the host's exposure.
- **Reuse Linux.** Block I/O goes to the host kernel, Linux schedules and manages memory across VMs, and networking uses TUN/TAP. This sacrifices host portability and inherits a larger trusted base, but operators keep their tools (ps, top, kill).
- **Jailer and seccomp.** The jailer places the VMM in a chroot, pid and network namespaces, drops privileges and applies a seccomp-bpf profile that whitelists 24 syscalls (with argument filtering) and 30 ioctls.
- **REST API over a Unix socket** to configure, start and stop a MicroVM, plus token-bucket rate limiters for disk and network. One Firecracker process runs per MicroVM.

## Methodology

The paper has two parts. Section 4 describes Lambda: a frontend, a Worker Manager that routes events, a Placement service that leases slots, and per-worker MicroManager, with one MicroVM per slot holding a single customer function and a shim. A slot lives at most 12 hours. The authors describe migrating Lambda to Firecracker on EC2 bare metal (internal AWS users first, separate metrics for old and new stacks, fast rollback, patching by re-imaging hosts).

Section 5 measures Firecracker v0.20.0 against QEMU v4.2.0 (minimal build, qboot BIOS) and Intel Cloud Hypervisor on an EC2 m5d.metal (two Xeon Platinum 8175M, 48 cores, hyper-threading off, 384GB, four 840GB NVMe, Ubuntu 18.04.2, kernel 4.15.0-1044-aws). Boot tests use a Linux 4.14.94 guest with 1 vCPU and 256MB, timing from VMM fork to guest init. I/O tests use 2 vCPUs and 512MB, fio with direct I/O for disks and iperf3 over a tap interface for networking. Data and scripts are public (nsdi2020-data).

## Findings

All numbers are the authors' own.

- **Headline claims** (with the recommended minimal guest kernel): memory overhead below 5MB per container, boot to application code in under 125ms, creation of up to 150 MicroVMs per second per host. The 150 per second figure appears in the introduction; I found no dedicated experiment for it in Section 5.
- **Boot.** Over 500 serial boots, pre-configured Firecracker (API calls done beforehand) and Cloud Hypervisor boot about twice as fast as QEMU, and end-to-end Firecracker falls in between. With 1000 MicroVMs started 50 at a time, the 99th percentile for pre-configured Firecracker is 146ms versus 158ms for Cloud Hypervisor, and 153ms with 100 concurrent starts. The stock Ubuntu 18.04 kernel adds about 900ms, and a network interface adds about 20ms (35ms for QEMU).
- **Memory overhead**, constant regardless of VM size: about 3MB for Firecracker, about 13MB for Cloud Hypervisor, about 131MB for QEMU. Section 5.4 states overhead "as low a 3%" on memory and negligible on CPU.
- **Block I/O.** 4kB reads are only 49 microseconds slower than native at queue depth 1, but 128kB I/O more than doubles latency. The guest is capped near 13,000 IOPS (52MB/s at 4kB) against over 340,000 IOPS of the hardware, because I/O is handled serially and flush-to-disk is not implemented, so write speed costs durability.
- **Network.** iperf3 gives about 15Gb/s for Firecracker against about 44 to 46Gb/s for the host and roughly 20 to 23Gb/s for Cloud Hypervisor. Up to 16 concurrent MicroVMs kept the same bandwidth.
- **Density.** Each worker runs hundreds or thousands of MicroVMs. The authors tested CPU and memory oversubscription above 20x and run production at up to 10x. At 125ms creation, one pooled MicroVM is needed per 8 creations per second (Little's law).

## Critical Analysis

What the paper does not claim: it does not offer a formal security proof or an attack evaluation, only a layered argument (hardware virtualization, Rust, testing, jailer, host hardening). Power and temperature side channels are explicitly left to the deployer. There is no device passthrough: the paper says virtio will not reach the near-bare-metal performance of PCI passthrough used by standard EC2 instances. There is no migration, BIOS, PCI or legacy device emulation, and it could not boot Windows without significant changes. Guests are Linux and OSv. It is not an orchestrator: it replaces QEMU, not Docker or Kubernetes. A single density number per host is not given, and the I/O numbers are acknowledged as limited. The Lambda and Fargate story is told in detail only for Lambda.

Comparisons are against QEMU stripped to a minimal build and a Rust VMM that shares code with Firecracker; the authors chose both configurations, and Firecracker's I/O results trade durability for speed. The design also leans on Linux for scheduling and memory management, while the paper itself cites the [wasted cores](/papers/linux-scheduler-decade-of-wasted-cores) study as criticism of that scheduler, so host-kernel quality stays part of the isolation story.

Later literature, not read in full here and marked as post-2020: the catalog entry on [Dirigent](/papers/dirigent-lightweight-serverless-orchestration) reports using Firecracker with and without snapshots. Ustiugov et al., "Benchmarking, Analysis, and Optimization of Serverless Function Snapshots" (ASPLOS 2021), I read only as an abstract: it studies snapshotting a booted function to cut cold starts. Du et al., "Catalyzer" (ASPLOS 2020), was seen only as metadata. Brooker et al., "On-demand Container Loading in AWS Lambda" (USENIX ATC 2023), I read as an abstract: it covers delivering container images to Lambda on demand. The paper itself names Kata Containers, gVisor and Cloud Hypervisor; how they evolved afterwards was not checked.

## Further Research

- Raising density without losing isolation, especially memory deduplication, given the side-channel risks the paper lists. [ESX Server](/papers/memory-resource-management-in-vmware-esx-server) describes content-based page sharing and ballooning for memory overcommit (the Firecracker paper does not cite it, and its host guidance disables samepage merging as a mitigation).
- Cutting startup and workload-switching cost further: one combined API call, doing memory allocation and kernel loading during configuration.
- Parallel block I/O, flush support and faster virtio networking.
- Hardware for high-density multi-tenancy, host bypass for networking, storage and accelerators, and a smaller virtualization trusted base.
- Schedulers that exploit MicroVM isolation, and alternative operating systems and programming models for serverless. See also [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) and [IX](/papers/ix-protected-dataplane-operating-system) for I/O paths that bypass the kernel with hardware virtualization.

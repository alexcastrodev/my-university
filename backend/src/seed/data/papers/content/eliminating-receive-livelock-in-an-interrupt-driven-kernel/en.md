---
title: "Eliminating Receive Livelock in an Interrupt-driven Kernel"
summary: Mogul and Ramakrishnan show that a kernel that handles packets at interrupt priority delivers less and less as input grows, down to zero, and fix it on a Digital UNIX router with interrupt-triggered polling, run-to-completion processing, queue feedback and a CPU cycle limit.
researchArea: Operating Systems
keywords: receive livelock, interrupt-driven kernel, polling, overload, packet forwarding, run to completion, queue feedback, CPU scheduling
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Most operating systems use interface interrupts to schedule network tasks. Interrupt-driven systems can provide low overhead and good latency at low offered load, but degrade significantly at higher arrival rates unless care is taken to prevent several pathologies. These are various forms of receive livelock, in which the system spends all its time processing interrupts, to the exclusion of other necessary tasks. Under extreme conditions, no packets are delivered to the user application or the output of the system. To avoid livelock and related problems, an operating system must schedule network interrupt handling as carefully as it schedules process execution. We modified an interrupt-driven networking implementation to do so; this eliminates receive livelock without degrading other aspects of system performance. We present measurements demonstrating the success of our approach.

## Overview

This paper appeared at the USENIX 1996 Annual Technical Conference (San Diego, January 1996), from DEC's Western Research Laboratory and AT&T Bell Laboratories. The extended journal version (ACM TOCS 1997) is a different item and was not read here. The argument starts from a mismatch of eras. Kernels such as 4.2BSD were built for devices that interrupt every few milliseconds, and an interrupt then cost only a fraction of the CPU. By 1996 NFS servers, multicast, multimedia and routers could generate packets orders of magnitude faster than a disk generates seeks, and many of those protocols are not flow-controlled, so nothing slows the sender down.

In 4.2BSD the device driver runs at high interrupt priority level (IPL), queues the packet and raises a software interrupt for IP at a lower IPL. The scheduler does not take part. Strict priorities mean that once the input rate exceeds the reciprocal of the CPU cost of handling one input event, nothing at lower priority runs. The authors call this receive livelock: not a deadlock, since the system recovers when the load drops, but no useful progress while it lasts. Compare this with the later work on overload in the catalog, such as [Targeted Task Cancellation](/papers/targeted-task-cancellation-for-application-resource-overload), which cites receive livelock as the classic case, and [Metastable Failures](/papers/metastable-failures-in-distributed-systems), which separates livelock from its own definition.

## Contribution

The paper contributes a model of overload behavior and a set of scheduling changes.

- **The model.** An ideal system delivers whatever is offered. A realizable one keeps up until the Maximum Loss Free Receive Rate (MLFRR) and stays roughly flat above it. A livelock-prone one delivers less as the offered load rises above the MLFRR, and livelock is the point where throughput reaches zero. Interrupt batching can raise the MLFRR but cannot by itself prevent livelock.
- **Three pathologies.** Receive livelock, extra latency for the first packet of a burst, and starvation of transmits when transmission runs at lower priority than reception.
- **Techniques.** Use interrupts only to start polling. Poll round-robin with a quota per callback. Disable input when a downstream queue is full or when packet processing uses too much CPU. Drop early, in the interface, and process each accepted packet to completion. Re-enable interrupts when no work is pending.

## Methodology

The test bed is an IP router built on Digital UNIX V3.2 (a DECstation 3000/300 Alpha, SPECint92 66.2, the slowest Alpha available, chosen to make livelock visible) between two otherwise idle Ethernets. A source host sends 10000 UDP packets with 4 bytes of data at various rates to a nonexistent destination (a phantom ARP entry), and the delivered rate is read from the output interface counter with `netstat`. The authors checked that count with a network analyzer. Each trial is one mark on the graphs, and the rates are averages over several seconds.

The modified kernel makes the interrupt handler schedule a polling thread and leave the device interrupt disabled. The thread calls each registered driver's callbacks with a packet quota, calls IP input directly (no IP input queue) and re-enables interrupts when nothing is pending. They also test with `screend`, a user-mode firewall program that makes one system call per packet. Queue feedback and the CPU cycle limit are added step by step.

## Findings

- **Unmodified kernel.** With `screend`, poor behavior above 2000 packets/s and complete livelock at about 6000. Without `screend`, a peak of 4700 packets/s, then a decline. The maximum Ethernet rate is about 14,880 packets/s, and the authors say livelock would probably set in somewhat below it.
- **Polling with quota 5 (without screend).** The curve in Figure 6-3 stays flat at about 5000 packets/s as the input grows past 10000 (read from the graph). With no quota, throughput falls almost to zero, because packets pile up and are dropped at the output queue and the transmit side starves.
- **Feedback with screend.** With a 32-packet screening queue, input inhibited at 75% full and re-enabled at 25% full (plus a one clock tick timeout, about 1 msec), there is no livelock and the peak is much higher. Figure 6-4 shows about 2800 packets/s, flat. Polling without feedback behaves about as badly as the unmodified kernel.
- **Quota.** Smaller is better without `screend`. Figure 6-5 shows quota 10 near 4300 to 4500 and quota 20 near 2200 to 2500 above the peak (read from the graph). With `screend`, small quotas cost about 5% of the maximum. The authors conclude that 10 to 20 packets is near-optimum for this hardware and that the value should be tunable.
- **User progress.** With the polling and feedback changes alone, a compute-bound process made no measurable progress under flood. With the cycle limit (10 msec period, threshold as a share of cycles) it gets about 94% of the CPU with no input and a stable share under load. Figure 7-1 shows about 65%, 44% and 15% for thresholds of 25%, 50% and 75%, below what the threshold implies (graph readings). The authors attribute the gap to overhead and to output work not being limited.

## Critical Analysis

What the paper does not claim. It measures one application: a router on one slow Alpha with Ethernet and UDP packets of 4 bytes. Network monitoring and NFS servers are named as motivating applications that were also fixed and shipped, but no measurements for them appear in the text. TCP and NFS stack performance was not measured because the modified code was not yet in a fast interface driver (FDDI). The packet filter queue and output queue feedback are only suggested. The high and low water marks were chosen arbitrarily, the CPU limit had no programming interface (a patched kernel variable), and interactive Telnet still suffers because packets are dropped. The change only moves when packets are dropped, not which ones, and the drop policy stays drop-tail. The modified kernel configured as unmodified ran slightly worse than the original, for reasons the authors say are not clear.

Later literature, marked as such and not read for this entry. The Linux kernel documentation on NAPI (read, docs.kernel.org/networking/napi.html) describes the same shape: the driver's interrupt handler schedules a poll, interrupts stay masked until polling finishes, the poll method has a budget of packets, and interrupts are unmasked only after the poll completes. That page does not mention this paper, so the lineage is my inference, not a stated fact. The catalog entries on [IX](/papers/ix-protected-dataplane-operating-system) (bounded batches run to completion, batching only under congestion), [Snap](/papers/snap-microkernel-approach-to-host-networking), [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) and [Arrakis](/papers/arrakis-operating-system-is-the-control-plane) take packet processing out of the kernel interrupt path in their own ways, per their catalog summaries. I did not check whether they cite this paper. Book vs today: gigabit and faster NICs, multiple cores and receive-side scaling change the arithmetic, and the single-CPU model here does not cover them.

## Further Research

- Queue-state feedback for other queues (output, packet filter), where the paper says the policies are harder because load may not be what blocks progress.
- Tuning of the quota and water marks for other CPUs and interfaces, which the authors leave open.
- A programming interface for the CPU limit, and measurement of TCP and NFS with a high-speed driver.
- Multicore scaling of the same ideas: see [Analysis of Linux Scalability](/papers/analysis-of-linux-scalability-to-many-cores) for what limits kernel network paths on many cores.
- Scheduling of packet work inside the kernel for modern RPC loads: [Rakaia](/papers/rakaia-in-kernel-scheduling-for-tcp-rpcs).

---
title: "Snap: a Microkernel Approach to Host Networking"
summary: Google moves host networking out of the kernel into a userspace system of modular engines, with transparent upgrades and a scheduler co-designed with the kernel.
researchArea: Operating Systems
keywords: network stack, datacenter, microkernel, rdma
version: 1.1
updatedAt: 2026-10-31
---

## Overview

Snap is the host networking system Google built to replace much of the kernel network stack on its machines. This SOSP 2019 paper presents its design and the experience of running it in production for more than three years.

The problem is that large providers need to add network features quickly (virtualization, traffic shaping, packet switching, a fast transport) while keeping performance high, and changing a kernel stack across a fleet is slow and risky.

## Contribution

The paper's contributions are an architecture and the operational lessons from it.

- A **microkernel-inspired** design: networking runs in a userspace process made of independently developed modules called engines, instead of in the kernel.
- A transport and messaging service called Pony Express, with an RDMA-like interface.
- Transparent upgrades of the networking service without moving applications off a machine.
- A CPU scheduling design that is split between the kernel and userspace and supports real-time behavior with dynamic scaling of CPU resources.

## Methodology

Snap engines are single-purpose packet-processing modules, built with principled synchronization and minimal shared state. Because they live in userspace they get address space isolation and the productivity of normal software development, and they can be released far more often than kernel code.

The paper describes the engine model, the control interfaces, how an upgrade starts a new instance of each engine while the old one still runs and then moves its state over during a short blackout, and the scheduling modes for the CPU cores engines use (dedicated cores, spreading engines and compacting engines). It evaluates the system with RPC workloads, a software RDMA-like workload, and upgrade measurements.

## Findings

These are the authors' reported results.

- More than 3x improvement in Gbps per core compared to a kernel networking stack for RPC workloads.
- Software-based RDMA-like performance of up to 5 million IOPS per core.
- Transparent upgrades that the authors describe as largely imperceptible to applications.
- Snap has been in production for more than three years and is deployed on over half of Google's fleet.

## Critical Analysis

This is an experience paper from one very large operator, and its value is in the practical lessons, not in a controlled comparison.

Points to read carefully:

- The baseline is a kernel stack tuned for general use, and the headline gain is for a specific RPC workload. The benefit for other traffic can differ.
- Some scheduling modes pin engines to dedicated hyperthreads, which trades CPU for latency, so the efficiency numbers depend on the mode chosen.
- The setting is a fleet where one operator controls the hosts, the network and the applications, which is far from a typical deployment, and the system is internal to Google, so the results cannot be reproduced outside it.

## Further Research

- How much of the approach carries over to operators without Google's control of hardware and software.
- Isolation and security between engines and applications in a shared userspace process.
- Combining userspace networking with newer kernel facilities for fast I/O.
- Scheduling for engines that mixes kernel-level guarantees with userspace policy (a theme the ghOSt paper takes further).

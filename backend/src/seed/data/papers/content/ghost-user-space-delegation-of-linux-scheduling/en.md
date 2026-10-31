---
title: "ghOSt: Fast & Flexible User-Space Delegation of Linux Scheduling"
summary: A way to run Linux scheduling policy in userspace agents while the kernel only actuates the decisions, so policies can change without rebooting the host.
researchArea: Operating Systems
keywords: scheduling, linux kernel, userspace delegation, tail latency, datacenter
version: 1.1
updatedAt: 2026-10-31
---

## Abstract

We present ghOSt, our infrastructure for delegating kernel scheduling decisions to userspace code. ghOSt is designed to support the rapidly evolving needs of our data center workloads and platforms. Improving scheduling decisions can drastically improve the throughput, tail latency, scalability, and security of important workloads. However, kernel schedulers are difficult to implement, test, and deploy efficiently across a large fleet. Recent research suggests bespoke scheduling policies, within custom data plane operating systems, can provide compelling performance results in a data center setting. However, these gains have proved difficult to realize as it is impractical to deploy a custom OS image(s) at an application granularity, particularly in a multi-tenant environment, limiting the practical applications of these new techniques. ghOSt provides general-purpose delegation of scheduling policies to userspace processes in a Linux environment. ghOSt provides state encapsulation, communication, and action mechanisms that allow complex expression of scheduling policies within a userspace agent, while assisting in synchronization. Programmers use any language to develop and optimize policies, which are modified without a host reboot. ghOSt supports a wide range of scheduling models, from per-CPU to centralized, run-to-completion to preemptive, and incurs low overheads for scheduling actions. We demonstrate ghOSt's performance on both academic and real-world workloads, including Google Snap and Google Search. We show that by using ghOSt instead of the kernel scheduler, we can quickly achieve comparable throughput and latency while enabling policy optimization, non-disruptive upgrades, and fault isolation for our data center workloads. We open-source our implementation to enable future research and development based on ghOSt.

## Overview

Where threads run, and for how long, strongly affects the throughput, tail latency and security of data center workloads. Yet kernel schedulers are hard to change: they are difficult to implement, test and roll out across a large fleet.

This SOSP 2021 paper from Google presents ghOSt, an infrastructure that delegates kernel scheduling decisions to code running in userspace on Linux.

## Contribution

ghOSt's contribution is a general-purpose delegation mechanism, not one new scheduling policy.

- Policies live in userspace agents, written in any language and updated without rebooting the host.
- The kernel provides **state encapsulation** (what the agent needs to know), **communication** and **action** mechanisms, and helps with synchronization between the kernel and the agent.
- It supports a wide range of models, from per-CPU to centralized and from run-to-completion to preemptive.
- It is meant to make practical the bespoke scheduling policies that recent research built into custom data plane operating systems, which are hard to deploy per application in a multi-tenant environment.

## Methodology

The design adds a ghOSt scheduling class to the Linux kernel. Threads managed by ghOSt are scheduled according to decisions that userspace agents send back, and the agents receive the state they need from the kernel. The public repository describes decisions being actuated as transactions and includes example policies such as centralized and per-CPU FIFO, a CFS-like policy and a Shinjuku-style policy.

The authors evaluate ghOSt on academic workloads and on real-world ones, including Google Snap and Google Search, by comparing it with the kernel scheduler.

## Findings

These are the authors' reported results, as stated in the abstract.

- Using ghOSt instead of the kernel scheduler, the authors quickly reach comparable throughput and latency.
- On top of that, it enables policy optimization, non-disruptive upgrades and fault isolation for their data center workloads.
- ghOSt incurs low overheads for scheduling actions across the supported scheduling models.
- The implementation is open source.

This analysis is based on the abstract and the project's public documentation. For numbers on specific workloads, go to the paper.

## Critical Analysis

The idea answers a real deployment problem, and the open source release makes it possible to try.

Points to read carefully:

- "Comparable" performance is the headline: the pitch is flexibility and operability more than speed, so the value depends on how much a custom policy gains for your workload.
- Moving decisions out of the kernel adds a communication step between the kernel and the agent. Check in the paper what the centralized and per-CPU models cost in CPU and latency.
- The abstract promises fault isolation. Check in the paper what happens to the threads when an agent crashes or falls behind.
- It needs a modified Linux kernel, which limits adoption outside operators who run their own kernels.

## Further Research

- Upstreaming the delegation interface into mainline Linux, or an equivalent that does not need a fork.
- Policies that use application knowledge better, such as request types or deadlines, and how to express them safely.
- Verifying userspace policies, since a bad policy can starve threads.
- Combining delegated scheduling with other userspace datapath systems (see Snap and Demikernel).

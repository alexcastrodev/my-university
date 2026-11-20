---
title: "Large-scale cluster management at Google with Borg"
summary: Verma and colleagues describe Borg, Google's cluster manager that runs production services and batch jobs together in cells of up to tens of thousands of machines, and report that sharing machines, fine-grained requests, large cells and resource reclamation each save machines, with the caveat that all data is Google's own.
researchArea: Distributed Systems
keywords: borg, cluster management, scheduling, cell compaction, resource reclamation, preemption, quota, performance isolation, lessons learned
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Google's Borg system is a cluster manager that runs hundreds of thousands of jobs, from many thousands of different applications, across a number of clusters each with up to tens of thousands of machines. It achieves high utilization by combining admission control, efficient task-packing, over-commitment, and machine sharing with process-level performance isolation. It supports high-availability applications with runtime features that minimize fault-recovery time, and scheduling policies that reduce the probability of correlated failures. Borg simplifies life for its users by offering a declarative job specification language, name service integration, real-time job monitoring, and tools to analyze and simulate system behavior. We present a summary of the Borg system architecture and features, important design decisions, a quantitative analysis of some of its policy decisions, and a qualitative examination of lessons learned from a decade of operational experience with it.

## Overview

The paper (EuroSys 2015, Bordeaux, 17 pages) describes the system that admits, schedules, starts, restarts and monitors the full range of Google's applications. It is a description by its own engineers after more than a decade in production, not a research prototype. The workload has two halves: long-running services that should "never" go down and answer latency-sensitive requests (Gmail, Google Docs, web search, and infrastructure such as BigTable), and batch jobs lasting from seconds to days. The median cell has about 10 k machines. Borg is the layer under [GFS](/papers/google-file-system), [BigTable](/papers/bigtable-distributed-storage-system-structured-data) and the MapReduce framework ([MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters)), all of which the paper says run on it.

Its coordination rests on papers already in the catalog: the Borgmaster keeps state in a Paxos-based store (the paper cites [The Part-Time Parliament](/papers/paxos-part-time-parliament); see also [Paxos Made Simple](/papers/paxos-made-simple)) and uses [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) to publish task addresses and the elected master. Borg's introspection covers per-task health pages, logs and metrics; [Dapper](/papers/dapper-large-scale-distributed-systems-tracing-infrastructure) is a sibling Google system that traces requests across services, a topic the Borg paper does not discuss.

Worth knowing first: what a container and a Linux cgroup are, and the difference between a scheduler (placing work) and an admission controller (deciding what may enter).

## Contribution

- **The model.** A **cell** is a set of machines managed as a unit inside one cluster. A **job** has one or more **tasks** running the same binary, each a set of Linux processes in a container (most of the workload does not run in VMs). An **alloc** is a reserved set of resources on a machine where tasks from different jobs can share a place (for example a web server and its logsaver). Jobs are written in BCL, a declarative language, and get stable names through the Borg name service (BNS), stored in Chubby.
- **Priority, preemption and quota.** Priorities form non-overlapping bands (monitoring, production, batch, best effort); production tasks may not preempt one another, to avoid preemption cascades. Quota is a vector of resources at a priority for a period (typically months), checked at admission, not at scheduling. Production quota is limited to the cell's real resources; quota at lower priority is oversold (priority zero is infinite).
- **Architecture.** The Borgmaster is logically one process, replicated five times, with one elected master (Paxos) that is also the Paxos leader and mutates state. The Borglet on each machine is polled by the master every few seconds. The scheduler is a separate process working on a cached copy of the state.
- **Scheduling.** A feasibility check (constraints and available resources, including those held by evictable lower-priority tasks) followed by scoring.
- **Scale techniques.** Score caching, equivalence classes and relaxed randomization.
- **Utilization and isolation.** Resource reclamation, cgroup-based containers and application classes (latency-sensitive vs batch).

## Methodology

Section 5 introduces **cell compaction**: take a workload and find how small a cell it fits in by removing random machines until it no longer fits, repacking from scratch each time. The experiments ran in Fauxmaster, a simulator that holds the full production Borgmaster code with stubbed Borglets, on checkpoints from real cells taken on Wednesday 2014-10-01 at 14:00 PDT. The authors chose 15 cells by excluding special-purpose, test and small (under 5000 machines) cells and sampling the rest across the size range. Each experiment ran 11 times per cell with different seeds, and the result is the 90th-percentile value. Hard constraints were turned into soft ones for jobs larger than half the original cell, and up to 0.2% of tasks could stay pending. It was not possible to experiment on live cells, except one week-by-week test of resource estimation in production. The CPI study (cycles per instruction) used about 12 000 random prod tasks over a week. Qualitative lessons come from experience, not from measurement.

## Findings

All numbers are the authors' own, from the text.

- **Scheduler scale.** A busy Borgmaster uses 10 to 14 cores and up to 50 GiB of RAM; several cells see over 10 000 task arrivals per minute. An online pass over the pending queue takes under half a second. Scheduling a cell's whole workload from scratch took a few hundred seconds, but did not finish after more than 3 days with score caching, equivalence classes and relaxed randomization disabled. The paper gives no breakdown per technique.
- **Scoring.** The original E-PVM variant spreads load ("worst fit"), which fragments; best fit packs tightly but penalizes mis-estimation, and 20% of non-prod tasks request under 0.1 core. The current hybrid reduces stranded resources and packs 3 to 5% better than best fit. Its formula is not given.
- **Availability.** Master election and failover typically take about 10 s, up to a minute in a big cell. The paper reports 99.99% Borgmaster availability, and that running tasks keep running if the Borgmaster or a Borglet goes down.
- **Sharing.** 98% of machines in shared cells run both prod and non-prod tasks (83% across all machines Borg manages). Segregating prod from non-prod needs 20 to 30% more machines in the median cell. Giving large users private cells (10 TiB or 100 TiB of memory thresholds) needs 2 to 16 times as many cells and 20 to 150% more machines. Splitting a cell into smaller ones needs more machines (Figure 7, graphical).
- **Interference.** CPI rises 0.3% per extra task on a machine, and under 2% per 10% more machine CPU use, but these explain only 5% of the variance. Mean CPI is 1.58 in shared cells and 1.53 in dedicated ones (about 3% worse); the Borglet itself runs 1.19 times as fast in dedicated cells. The authors call the results "not clear-cut" and still conclude sharing is a win.
- **Fine-grained requests and reclamation.** Rounding requests up to powers of two would need 30 to 50% more resources in the median case. About 20% of the workload runs on reclaimed resources in a median cell. A week of aggressive reclamation settings slightly raised out-of-memory events; the authors deployed the medium setting.
- **Isolation.** 50% of machines run 9 or more tasks; the 90th percentile has about 25 tasks and 4500 threads. Task start median is about 25 s, 80% of it package installation.
- **Lessons, the bad.** Jobs are too restrictive as the only grouping; one IP address per machine forces port management; features for power users (about 230 BCL parameters) burden casual ones.
- **Lessons, the good.** Allocs; cluster management is more than task management (naming, load balancing); introspection is vital; the master is the kernel of an ecosystem of services.

## Critical Analysis

What the paper does not claim or measure:

- **Not independent.** Every number comes from Google's own cells, and the authors wrote the system and the evaluation. The simulation is of one point in time, not a replay of a workload over time, and the paper says it believes results would not differ much, which is a belief, not a result.
- **Compaction is a proxy.** It measures packing efficiency, not user-visible latency or throughput. Results are 90th-percentile values from 11 trials with softened constraints and 0.2% pending tasks.
- **Partial evidence on interference.** The authors admit performance comparisons at warehouse scale are tricky; the CPI correlations are weak and a selection bias is possible.
- **No comparison with other managers.** Related work (Mesos, YARN, Omega, Fuxi, Apollo) is discussed in prose only; there is no head-to-head measurement. Kubernetes appears only as an open-source system under development by many of the same engineers, and the lessons section describes design intent, not an evaluation of it.
- **Unspecified details.** The hybrid score formula is not given, nor the number of machines examined by relaxed randomization ("enough" feasible machines), nor the performance of the Paxos store.

Later literature, which I did not read for this entry: the paper itself calls its scheduler split similar in spirit to the optimistic concurrency of Omega (Schwarzkopf et al., EuroSys 2013), and says its lessons feed Kubernetes. A later link in the catalog: [Dirigent](/papers/dirigent-lightweight-serverless-orchestration) cites Borg cells as a way to split a control plane. Borg rate-limits rescheduling of tasks from unreachable machines and polls Borglets to avoid recovery storms; these relate to the retry-driven failure patterns in [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild), a connection I draw, not one the Borg paper makes.

## Further Research

- Interference at finer timescales that cgroups and CFS tuning leave open, such as memory bandwidth and L3 cache pollution, which the paper says still happen ([Caladan](/papers/caladan-mitigating-interference-at-microsecond-timescales), [Shenango](/papers/shenango-achieving-high-cpu-efficiency-for-latency-sensitive-datacenter-workloads)).
- Tail-latency effects of sharing machines ([The Tail at Scale](/papers/the-tail-at-scale)).
- Comparing Borg's centralized scheduler with Omega-style shared-state schedulers and with Kubernetes under the same workload, which the paper does not do.
- Packing metrics that account for time-varying load, beyond one-time cell compaction.

---
title: "Mitigating Application Resource Overload with Targeted Task Cancellation"
summary: Atropos treats overload caused by contention on internal resources such as locks, buffer pools and queues as a culprit-finding problem, tracing what each cancellable task holds, estimating which one would free the most contended capacity, and cancelling it through the application's own cancellation hook instead of dropping the victims.
researchArea: Distributed Systems
keywords: overload control, task cancellation, resource contention, tail latency, slo, performance isolation
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Servers run close to peak throughput, so a short spike in demand can cause many service-level objective (SLO) violations. Besides the classic receive livelock, overload can come from contention on application-level resources such as table locks or a database buffer pool. One request may hold such a resource for a long time and block every request that needs it, and its damage depends on how it interacts with the others. The authors contrast a single-row update that locks a table for about 2 ms with a long grouped write that can hold locks on several tables for hundreds of seconds, so one long write can hurt more than hundreds of short requests together.

This SOSP 2025 paper (Seoul), from Boston University, Johns Hopkins University, the University of Michigan, UCLA and the University of Washington, argues that the two usual families of defences miss this case. Admission control looks at global signals such as queueing delay and drops requests that are victims, often before they are served. Performance isolation gives requests resource quotas: static partitions cannot adapt to variable workloads, and even dynamic ones such as pBox cannot remove a request that already holds the contended resource. Atropos is their alternative: let requests run, watch what they consume, and cancel the culprit.

Six terms carry the paper. A **cancellable task** is a unit of work that can be cancelled, such as a request, all requests of one user connection, or a background job. An **application resource** is a logical resource defined by the application (a lock, a queue, a memory pool) rather than by the OS. **Contention level** measures how contended a resource is, and **resource gain** estimates how much of it would be freed if a given task were cancelled. A **culprit** is a task that monopolizes a resource, and a **victim** is a task blocked by it.

Worth knowing first: SLOs and tail latency, how load shedding and admission control work, and the cancellation features that languages already offer (Go contexts, Java thread interruption). The library has [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems), which this paper does not cite. Its list of overload responses includes load shedding and circuit breakers, which is the family Atropos argues hits the wrong requests. The failure mode differs, though: a metastable failure outlives its trigger, while here the cause is a request that is still running.

## Contribution

- **Cancel the culprit, not the victim.** The authors say Breakwater throttles on queueing delay without knowing which resource is contended, and that Protego drops requests whose lock waits approach an SLO violation, which are victims of the contention. pBox reallocates resources but does not drop a running request. Atropos does no admission control itself and acts on requests that are already executing.
- **Safe cancellation by reuse.** Killing a task blindly could leave state inconsistent, for example a backup that covers only some tables. The authors studied 151 popular open-source applications and found that 115 (76%) implement task cancellation, and 109 of those (95%) expose an initiator function. Atropos registers that function with `setCancelAction` (MySQL's `sql_kill` in the example) and lets the application decide how to stop safely. A library-level fallback such as `pthread_cancel` exists but is off by default.
- **A small integration API.** `createCancel` and `freeCancel` mark the scope of a task, and developers choose the granularity. Three calls, `getResource`, `freeResource` and `slowByResource`, report acquisition, release and waiting for a resource of type LOCK, MEMORY or QUEUE. Timestamps are sampled at fixed intervals and switch to per-event precision once a possible overload is detected.
- **Detection and metrics.** Following Breakwater's method, a resource overload is suspected when latency exceeds the SLO while throughput stays flat, and the estimator then checks whether a specific resource is the bottleneck. Otherwise it is a regular overload left to other mechanisms. Contention is the eviction ratio for memory, wait time over use time for locks, and wait time over execution time for queues, then normalized as the fraction of execution time lost. Resource gain is the task's future usage: its current usage scaled by remaining work over completed work, with progress taken from the GetNext model (rows processed over rows expected). For example, a write that has held a table lock for 1 second and is 40% done has a gain of 1.5 seconds.
- **Multi-objective policy.** Atropos keeps the tasks not dominated by any other across all resources, then picks the one with the highest sum of gain weighted by contention level. With contention of 0.6 for memory and 0.4 for a lock, a task gaining 3 and 1 scores 2.2 and beats one gaining 2 and 2, which scores 2.0. Only tasks registered as cancellable are considered.
- **Fairness and size.** A task is cancelled at most once, re-executed after resources have stayed available, and then marked non-cancellable. A cancelled request that exceeds its SLO while waiting is dropped, and background tasks get a maximum waiting time. The implementation is 4,002 lines of C/C++ (a library), 3,534 of Java (a `CancellableTask` class) and 2,106 of Go (inside the Go runtime).

## Methodology

The authors integrated Atropos into six applications: MySQL, PostgreSQL, Apache, Elasticsearch, Solr and etcd. The lines added were 74, 59, 30, 65, 47 and 22, and MySQL has about 20 application resources. They report that finding the resources took far longer than editing code: about seven days for one graduate student on MySQL, two days each on Apache and etcd, and four to five days each on the others, helped by a heuristic over global variables and static analysis of their usage.

The benchmark is 16 real overload cases gathered from bug trackers, forums and blog posts, kept when reproduction steps were clear: eight on synchronization resources, three on thread pools, three on memory and two on system resources (CPU and I/O). Standard benchmark tools (Sysbench, ApacheBench, Rally, Solrbench, etcdbench) were modified to issue the triggering request sequences. Runs used Azure VMs with 16 vCPUs, 64 GB of memory and Ubuntu 20.04. The baselines are Protego, pBox, DARC and PARTIES, which the authors integrated into the applications themselves. Two MySQL experiments motivate the work: a 512 MB buffer pool over 2 GB of data with rare 2 GB dump queries, and scans plus a backup query that stretch table locks.

## Findings

These are the authors' reported results.

- **The motivating cases.** Dump queries at 0.001% of the load cut MySQL's maximum throughput from about 25 K QPS to about 18 K, and at 0.01% to about 12 K. With scan queries and a backup query, throughput fell to about 11 K QPS, against about 25 K without either.
- **Mitigation.** Across the 16 cases Atropos averages 96% of baseline throughput and a normalized p99 latency of 1.16. The other four systems average 50.7% (Protego), 53.9% (pBox), 36.3% (DARC) and 37.8% (PARTIES).
- **Where Protego falls short.** Its average normalized p99 is 1.88 on synchronization and system-resource cases, and it does not address contention on resources it does not monitor.
- **Drops.** Atropos averages a drop rate below 0.01%, while Protego averages about 25% because it drops victims.
- **SLO attainment.** With an SLO tolerating a 20% latency increase, Atropos meets it in 14 cases with an average increase of 10.2%. Cases 3 and 12 end at 23% and 26%. The authors blame a deliberate pause between cancellations and the many noisy tasks in those cases. At thresholds of 10%, 20%, 40% and 60% over six cases, the SLO is met every time, with more cancellations as it tightens.
- **Policy ablation.** The multi-objective policy beats a heuristic that targets the highest gain on the single most contended resource in 8 of 16 cases, and beats the variant using current instead of future usage in 6.
- **Overhead.** Under normal load throughput drops by 1.95% at most (0.59% on average) and p99 rises by 0.21% on average (1.55% at most). Under overload, with cancellation disabled to isolate tracing, throughput falls 7.09% on average (8.12% at most) and p99 rises 8.12% on average (16.14% at most).
- **Apache.** Noisy requests run PHP scripts that Apache's own mechanism cannot stop, so the authors enable `pthread_cancel` and argue it is safe because the scripts run outside the core logic and unflushed writes are simply discarded.

## Critical Analysis

The paper is open about several limits.

- **A strong prediction assumption.** Future usage is assumed proportional to remaining work. The authors call this strong and possibly inaccurate, and defend it by speed, by heavy requests dominating a resource for most of their life, and by the cheap cost of a wrong guess, since Atropos can cancel again.
- **Coverage is bounded by registration.** Only tasks marked cancellable are considered, so the globally best victim may be missed. Thread-level cancellation is coarse and possibly unsafe.
- **Single node.** The design targets one node. Propagating cancellation to child tasks, and surviving crashes, timeouts and partitions, is left as future work.
- **Speed against recovery.** The two missed SLO cases show the cost of spacing out cancellations, and finding all resources remains manual.

The following points are a reading of the evidence, not claims of the paper.

- **The benchmark favours the idea.** The 16 cases were kept because they reproduce cleanly, and the tools were modified to trigger them. Most are a few heavy requests among light ones, which is the shape Atropos suits best. Cases 3 and 12, where several noisy tasks are involved, are the two that fall short.
- **Baselines and spread.** The four baselines were ported or extended by the authors (Protego's algorithm was moved into Atropos's framework for Java, DARC was taught the request types, PARTIES was changed to work per client). No repetition counts or error bars appear in the text, and the introduction names three baselines while the evaluation uses four.
- **Figures and text do not line up.** The text averages over 16 cases, but Figure 9 and the latency panel of Figure 10 label only c1 to c15, and Figure 11 plots ten cases. The paper does not say which cases enter each average. The setup names Azure VMs, while the acknowledgments thank CloudLab for the experiment platform.
- **The price of cancelling is not itemized.** The text does not report how many cancelled tasks were re-executed, how long they waited, or how much work was wasted. The claim that re-execution is correct rests on the application's cancel logic rolling back cleanly and on requests being safe to run again, which is argued, not tested with non-idempotent requests.
- **Estimation is tested lightly.** Progress needs a signal such as rows examined, and applications without one need developer code. The policy is compared against two variants only, and nothing probes how wrong progress estimates change decisions.
- **Retried culprits are tolerated.** A re-executed task is non-cancellable, so a culprit that returns must be endured. Many distinct heavy requests, each cancelled once and then left alone, is a case the paper does not discuss.

## Further Research

- Distributed cancellation, as the authors describe it: associating child tasks with a root request, propagating cancellation, and handling crashes, timeouts and partitions.
- Better future-usage estimates than the proportional model, with a sensitivity study of how bad progress signals affect which task is cancelled.
- Automating the discovery of application resources, which took days per system, for instance by extending the global-variable and static-analysis heuristic.
- Testing whether targeted cancellation also helps when a feedback loop such as retries sustains the overload, the setting of [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems), which this paper does not study.

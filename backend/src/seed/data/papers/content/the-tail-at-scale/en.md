---
title: "The Tail at Scale"
summary: Dean and Barroso show that rare latency hiccups in single servers dominate response time once a request fans out to many servers (63% of requests slow with 100 servers at 1 in 100), and describe the techniques Google uses to tolerate them, from hedged and tied requests to micro-partitions and canary requests.
researchArea: Distributed Systems
keywords: tail latency, fan-out, hedged requests, tied requests, micro-partitions, selective replication, canary requests, tail-tolerant systems
version: 1.0
updatedAt: 2026-11-20
---

## Overview

Systems that answer within about 100 ms feel fluid to users, and Google search updates results as the user types, consulting thousands of servers. The paper (Communications of the ACM, February 2013, pp. 74-80, in the "contributed articles" section; it has no abstract, only a standfirst) starts from one observation: at that scale a rare slow response from one machine stops being rare for the whole request. The authors propose treating this as fault tolerance is treated: a predictably responsive whole built from less-predictable parts, which they call "latency tail-tolerant" systems.

It is a synthesis of practices used in Google systems, and it ties together several papers in the catalog. [BigTable](/papers/bigtable-distributed-storage-system-structured-data) and [GFS](/papers/google-file-system) supply the benchmarks, [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) is the batch workload sharing the cluster, and [Dapper](/papers/dapper-large-scale-distributed-systems-tracing-infrastructure) is the tracing system that makes this kind of tail visible. Quorum protocols such as [Paxos](/papers/paxos-made-simple) are named as inherently tail-tolerant. Hedging reappears in [Zanzibar](/papers/zanzibar-googles-consistent-global-authorization-system) and, inside consensus, in [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus). The microsecond-scale schedulers [Shinjuku](/papers/shinjuku-preemptive-scheduling-for-usecond-scale-tail-latency) and [Shenango](/papers/shenango-achieving-high-cpu-efficiency-for-latency-sensitive-datacenter-workloads) attack single-machine causes of the same tail.

Worth knowing first: percentile latency (the 99th percentile is the value 99% of requests beat) and the root-to-leaf request tree of a fan-out service.

## Contribution

- **The amplification argument.** If a server answers in 10 ms but has a 99th-percentile latency of one second, one request in 100 is slow when handled by a single such server. If the request needs 100 such servers in parallel, 63% of requests take over one second. With one in 10,000 slow at the server and 2,000 servers, almost one in five requests (0.18 in the figure) is slow.
- **Causes of variability.** Shared resources on a machine (CPU cores, caches, memory and network bandwidth), daemons, global resource sharing (network switches, shared file systems), maintenance activities (data reconstruction, BigTable log compactions, garbage collection) and multiple layers of queueing. Hardware adds power limits and throttling, garbage collection in solid-state storage (read latency up to 100 times higher with modest write activity) and energy-saving modes.
- **Reducing component variability.** Service classes and shallow low-level queues, breaking long requests into smaller ones against head-of-line blocking, and throttling, splitting or synchronizing background work. Caching is explicitly said not to address tail latency directly.
- **Within-request adaptations** (tens of milliseconds): hedged requests, tied requests.
- **Cross-request adaptations** (tens of seconds to minutes): micro-partitions, selective replication, latency-induced probation.
- **For retrieval systems:** "good enough" results and canary requests. A short section covers mutations, which the authors say are easier to make tail-tolerant.

## Methodology

There is no experimental design of the usual kind. The paper explains the problem with a hypothetical model (Figure 1) and one measurement from a real Google service (Table 1), then describes each technique with a short account of how Google uses it, plus two benchmarks: a 1,000-key BigTable read with hedging, and a BigTable read benchmark with tied requests (Table 2). No code, workloads or cluster sizes beyond what is quoted below are given, and the results are not repeated or compared with other systems.

## Findings

All figures are the authors' own, as printed in the text and tables.

- **Real service (Table 1).** Measured at the root of a large fan-out tree, one random leaf finishes in 10 ms at the 99th percentile, but all leaves finishing takes 140 ms, and 95% of leaves takes 70 ms. Waiting for the slowest 5% is responsible for half of the 99th-percentile latency. Medians go from 1 ms (one leaf) to 40 ms (all leaves).
- **Hedged requests.** Sending the secondary request only after the first has been outstanding past the 95th-percentile expected latency limits extra load to about 5%. In a benchmark reading 1,000 keys from a BigTable table spread over 100 servers, a hedge after 10 ms cuts the 99.9th-percentile latency for all 1,000 values from 1,800 ms to 74 ms, while sending only 2% more requests.
- **Tied requests (Table 2).** Each copy carries the identity of the other and cancels it when it starts. On a mostly idle cluster, with a tied request after 1 ms, median read latency goes from 19 ms to 16 ms (-16%), the 99th percentile from 67 ms to 42 ms (-37%) and the 99.9th from 98 ms to 61 ms (-38%). With a concurrent terasort job, the 99.9th goes from 159 ms to 108 ms (-32%), and the profile is nearly identical to the idle cluster without tied requests. Disk utilization overhead is under 1%.
- **Micro-partitions.** With 20 partitions per machine, load can be shed in roughly 5% steps and in 1/20th of the time of a one-to-one mapping. BigTable machines manage between 20 and 1,000 tablets.
- **Others, described without numbers.** Latency-induced probation (a slow machine is excluded but still gets shadow requests), good-enough results (a leaf holds the best result for under one in 1,000 queries) and canary requests (a request goes first to one or two leaves, and is used for every request in Google's large fan-out search systems).

## Critical Analysis

What the paper does not claim or measure:

- **A synthesis, not an evaluation.** The only measurements are two benchmarks and one table, all from Google, none independent, and none compared with the alternative techniques the text discusses (probing queues, load-aware routing). Most techniques (probation, good enough, canary requests, selective replication) come with no numbers at all.
- **Extra load has a price.** Hedging adds requests; the 2% and 5% figures belong to the cases described, and the text says naive hedging typically adds unacceptable load. Aggressive hedging needs faster cancellation. Tied requests have a window of about one network message delay where both copies can run. Do not read the 5% as the cost of the benchmark: it is the bound of the deferral rule, and the benchmark itself sent 2% more requests.
- **An assumption on independence.** The authors say these techniques work only when the cause of slowness does not hit several replicas at once, and "expect" such uncorrelated causes to be common, without measuring it.
- **Scope.** The techniques are said to fit operations that do not mutate critical state; for mutations the paper gives short arguments (small scale, off the critical path, quorums) and no evaluation.
- **Hardware claims are predictions.** The statements that variability will grow and that RDMA and better bisection bandwidth will make tied requests cheaper are expectations, not results.

Later literature, linked through catalog entries and not through the original papers: [Metastable Failures](/papers/metastable-failures-in-distributed-systems) describes retries as a sustaining effect that raises load during overload, which is a reason to treat the extra load of any retry-like technique as a risk to budget. The catalog's [Zanzibar](/papers/zanzibar-googles-consistent-global-authorization-system) analysis records that the paper deliberately avoids hedging between its own servers because it would duplicate the most expensive checks. I did not read the later work on microsecond-scale tails (Caladan and others) for this entry.

## Further Research

- Techniques that work at microsecond scale, where preemption and core allocation matter more than replica choice ([Shinjuku](/papers/shinjuku-preemptive-scheduling-for-usecond-scale-tail-latency), [Shenango](/papers/shenango-achieving-high-cpu-efficiency-for-latency-sensitive-datacenter-workloads)).
- Measuring how correlated the slow episodes across replicas really are, which decides when hedged and tied requests help.
- Budgeting the extra load of hedging, retries and canaries so they do not cause overload themselves ([Metastable Failures](/papers/metastable-failures-in-distributed-systems)).
- Tail-tolerant consensus without timeouts ([QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus)).

---
title: "Orleans: Cloud Computing for Everyone"
summary: Orleans is a .NET framework that gives cloud applications isolated, single-threaded actors called grains, replicated on demand into activations, with promises for asynchrony and lightweight optimistic transactions plus branch-and-merge reconciliation for consistency. This is the 2011 design, before the virtual actor model of the 2014 report.
researchArea: Distributed Systems
keywords: actor model, grains, activations, promises, lightweight transactions, branch-and-merge, cloud programming
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Cloud computing is a new computing paradigm, combining diverse client devices (PCs, smartphones, sensors, single-function, and embedded) with computation and data storage in the cloud. As with every advance in computing, programming is a fundamental challenge, as the cloud is a concurrent, distributed system running on unreliable hardware and networks. Orleans is a software framework for building reliable, scalable, and elastic cloud applications. Its programming model encourages the use of simple concurrency patterns that are easy to understand and employ correctly. It is based on distributed actor-like components called grains, which are isolated units of state and computation that communicate through asynchronous messages. Within a grain, promises are the mechanism for managing both asynchronous messages and local task-based concurrency. Isolated state and a constrained execution model allow Orleans to persist, migrate, replicate, and reconcile grain state. In addition, Orleans provides lightweight transactions that support a consistent view of state and provide a foundation for automatic error handling and failure recovery. We implemented several applications in Orleans, varying from a messaging-intensive social networking application to a data- and compute-intensive linear algebra computation. The programming model is a general one, as Orleans allows the communications to evolve dynamically at runtime. Orleans enables a developer to concentrate on application logic, while the Orleans runtime provides scalability, availability, and reliability.

## Overview

Cloud software is concurrent and distributed, runs on commodity machines that fail, and must absorb loads that vary unpredictably. Systems such as [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) fit offline batch work, but the paper argues they do not serve interactive requests that touch a small set of related items. This SoCC 2011 paper, from Microsoft Research, proposes the opposite bet: a deliberately constrained actor model for .NET that steers developers toward scalable patterns, with the runtime taking over persistence, replication and error recovery.

Do not read it as the "virtual actor" paper. That is the 2014 technical report by Bernstein and co-authors, which Orleans later became known for. The 2011 design is different in several ways, listed under Critical Analysis. Knowing the later Orleans in .NET helps, but is not required.

## Contribution

- **Grains.** The actor unit. Grains share no memory, are internally single-threaded, and run each request as a turn that completes before the next one starts, so locks are unnecessary inside a grain. Interfaces are ordinary .NET interfaces whose methods all return promises.
- **Promises.** A call returns immediately with a promise that is unresolved, fulfilled or broken. Errors propagate through chained promises like an asynchronous try/catch.
- **Activations.** A busy grain can have several activations running independently, possibly on different servers. The paper says this extends the classical actor model and that no other actor language intrinsically supports replication.
- **Reconciliation.** Activations of one grain branch revisions of its persistent state from storage and merge them back with a branch-and-merge model, with built-in reconcilable records, lists and dictionaries and room for custom policies.
- **Lightweight transactions.** Each external request runs as a transaction over every grain it touches. It sees a single activation of each grain, can abort and be re-executed on failure, and is committed to storage asynchronously (optimistic) or waited on (pessimistic).

## Methodology

The paper describes the programming model and the runtime, then three applications. Chirper is a Twitter-like pub/sub service written in 200 lines of Orleans C#. A linear algebra library, written by a coworker, uses worker and coordinator grains. A graph engine puts a partition of nodes (10^4 to 10^6) in each grain. Measurements ran on up to 50 servers, each with two quad-core 2.10 GHz AMD Opterons, 32 GB of RAM and Windows Server 2008 R2. The tests were micro benchmarks of invocation and promise cost, Chirper throughput on a synthetic network of 1,000 accounts each following 27 random users, an overload test on one grain, and PageRank on a 134 million page web graph.

## Findings

Numbers below are from the text. Figures 5 to 9 are plots, and I used only values stated in the text.

- **Invocation.** Round-trip latency of a grain call is about 1.2 ms remote and 0.5 ms local (Figure 5 shows average and 95th percentile). A promise costs 50 to 100 microseconds. Creating a grain takes about 5 ms, including its first activation and directory registration.
- **Chirper.** Throughput scales linearly with servers: about 7,000 chirps per second with 35 servers, versus a cited average of about 1,600 tweets per second on Twitter and a recorded peak of 6,939 in one second. Servers ran at 94 to 96 percent CPU, mostly serializing messages.
- **Hot grain.** With 10 ms of processing per message, creating several activations of one grain on a single machine keeps throughput scaling almost linearly (Figure 7, no number in the text). Turning transactions off, with one activation per grain, gave 13 percent more throughput at 10 ms of work and 2 percent at 100 ms, compared with transactions on and one activation. The two mechanisms could not be measured separately.
- **PageRank.** 10 iterations on 134 million pages and 1.4 billion links. On one machine it does not scale well because I/O saturates. Across servers it is near-linear to 4 servers and reaches a speedup of 13 at 32. The authors say the same program scaled from 16 to 512 cores unchanged. It ran roughly two orders of magnitude faster than a Dryad implementation, which the authors attribute mainly to keeping data in memory between iterations and dynamic load balancing, at the cost of more code.

## Critical Analysis

The paper reports no production experience: "It is too early to report on our experience". The evidence is one social benchmark, one I/O-bound computation and a graph engine with no measurements. The authors state two limits themselves: the system store is a single point of failure and a bottleneck, and partitioning a very large grain (a popular account) is left to the developer.

The following points are a reading of the paper, not claims it makes.

- **The consistency story is the least tested part.** Transactions are weaker than snapshot isolation (they allow write-write conflicts), and the paper has no failure experiment, no abort rate and no test of the commit path. Persistence uses two-phase commit, a protocol the paper treats as given (see [Consensus on Transaction Commit](/papers/consensus-on-transaction-commit) for its blocking trade-offs).
- **No membership or partition story.** The text never discusses failure detection, server membership, or network partitions, and cites no consensus protocol. The directory is only described as a one-hop hash table with adaptive caching. [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) and [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) are the usual reference points for that problem, but this paper does not use them.
- **Reconciliation is a different bet than convergent types.** Merges use application-defined policies and may be rejected and retried. [CRDTs](/papers/conflict-free-replicated-data-types) guarantee convergence by construction instead. The paper does not compare them.

Later literature (not part of this paper). I read in part the 2014 technical report by Bernstein, Bykov, Geller, Kliot and Thelin (MSR-TR-2014-41), Sections 2 to 3 and the start of Section 4. It describes a model where actors have perpetual existence logically and are activated on demand, single activation is the default, and stateless workers are the only multi-activation mode, with no state reconciliation. It states that Orleans "does not yet support cross-actor transactions". It adds a membership mechanism with heartbeats and a directory partitioned by consistent hashing, and it says a single activation is guaranteed only eventually after failures. In the parts I read, the 2011 transactions and branch-and-merge do not appear, so they seem not to be the path that stayed. I did not read the later Orleans transactions work, Akka Cluster Sharding, Cloudflare Durable Objects or Azure Durable Functions, so I make no claims about them.

## Further Research

- Read the 2014 report next: virtual actors, membership, directory and the Halo 4 Presence evaluation are all there, and it is the bridge to the Orleans in .NET.
- Compare what 2011 promised (replicated grains, atomic multi-grain requests) with what the 2014 report kept, and why cross-grain transactions came back only later.
- Measure failure behavior the paper omits: abort and retry rates, commit latency, and recovery after a server loss.
- Weigh convergent data types such as [CRDTs](/papers/conflict-free-replicated-data-types) against branch-and-merge for grain state.

---
title: "FoundationDB: A Distributed Unbundled Transactional Key Value Store"
summary: A transactional key-value store that splits transaction processing, storage and configuration into parts that scale on their own, and tests itself with deterministic simulation.
researchArea: Databases
keywords: unbundled database, oltp, strict serializability, multiversion concurrency control, optimistic concurrency control, simulation testing
version: 1.1
updatedAt: 2026-10-31
---

## Overview

FoundationDB is an open source, ordered key-value store that offers ACID transactions across arbitrary keys, and it runs in production at Apple, Snowflake and other companies. This SIGMOD 2021 industry paper describes the design after more than ten years of development.

The question behind it is practical: how do you keep the scalability of a NoSQL system while giving applications strict serializability, and how do you keep a system this hard to get right correct as it keeps changing?

## Contribution

The paper argues for three decisions that work together.

- **Unbundling.** An in-memory transaction system, a distributed storage system and a configuration system are separate roles, each provisioned and scaled on its own.
- **A small feature set.** The core offers ordered keys and transactions and nothing more, and richer data models (semi-relational, document, graph) are built as layers on top.
- **Recovery and testing as design goals.** Instead of masking failures with quorums, the transaction system is replaced as a whole when something fails, and every new feature is exercised under a deterministic simulation of the cluster with injected faults.

## Methodology

The paper is a system description backed by production measurements.

The control plane keeps its configuration on Coordinators (a disk Paxos group) and runs singleton roles: a ClusterController, a Sequencer that hands out versions, a DataDistributor and a Ratekeeper for overload protection. The data plane has Proxies, Resolvers, LogServers and StorageServers.

A transaction reads at a version, buffers its writes in the client, and at commit gets a commit version from the Sequencer. Resolvers then check read-write conflicts (optimistic concurrency control on top of multiversion storage), and the transaction is committed once all designated LogServers have persisted it. StorageServers pull the logs and apply them. Transactions are limited to 10 MB and the multiversion window is about 5 seconds.

For testing, the whole cluster runs in one process as a deterministic discrete-event simulation, written in Flow (an actor extension to C++), with randomized workloads and fault injection. The evaluation measures one geo-replicated Apple production cluster and a synthetic scalability test.

## Findings

These are the authors' reported results.

- Tolerating f failures takes f + 1 replicas rather than the 2f + 1 of quorum-based designs, because failures are handled by reconfiguration.
- The production cluster measured has 58 machines, 862 FDB processes and 292 TB of data. Reads average about 1 ms (99.9th percentile about 19 ms) and commits average about 22 ms (99.9th percentile about 281 ms). The average conflict rate over the month was 0.73%.
- In August 2020 that cluster had one transaction system recovery, which took 8.61 seconds. The authors relate this to five nines of availability.
- In the scalability test (4 to 24 machines), write throughput for transactions of 100 operations grew 5.84x and 90/10 read-write operations per second grew 4.69x. Writes saturated the LogServers and mixed traffic saturated Resolvers and Proxies.

## Critical Analysis

The strongest part is how candid the paper is about trade-offs: simulation cannot reliably find performance problems such as a weak load-balancing algorithm, and some bugs came from the operating system contract being weaker than assumed.

Points to read carefully:

- The scalability numbers come from a synthetic workload on small values and one cluster layout, and there is no head-to-head comparison with other databases, so they show how FoundationDB scales, not how it ranks.
- Optimistic concurrency, a 5 second window and a 10 MB limit fit short transactions with low contention. Long-running or highly contended workloads are outside what is shown.
- The availability figure rests on a single month and a single recovery, so it is an anecdote about one deployment more than a measured guarantee.
- The simulation approach cannot test third-party libraries or dependencies, or first-party code that is not written in Flow, so the authors have largely avoided depending on external systems.

## Further Research

- Applying deterministic simulation to systems that were not written for it, without rewriting them.
- Detecting performance regressions in simulation, which the paper names as a gap.
- Transactions that last longer than the multiversion window without giving up serializability.
- A fair comparison of unbundled and tightly integrated designs under the same workloads and hardware.

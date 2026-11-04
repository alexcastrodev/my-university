---
title: "Eris: Coordination-Free Consistent Transactions Using In-Network Concurrency Control"
summary: Eris moves transaction ordering into the datacenter network through a primitive called multi-sequencing, so that independent transactions commit in a single round trip without coordination between shards or replicas in the normal case.
researchArea: Distributed Systems
keywords: distributed transactions, in-network concurrency control, multi-sequencing, independent transactions, strict serializability, programmable switches
version: 1.0
updatedAt: 2026-11-03
---

## Overview

A storage system that is both partitioned and replicated usually stacks Paxos for replication, two-phase commit for atomicity and two-phase locking for isolation. Each layer adds rounds of messages, and held locks block conflicting transactions.

This SOSP 2017 paper from the University of Washington builds on [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering), which ordered messages for a single replica group inside the network. Transactions need more: shards see different sets of operations, yet must apply cross-shard transactions in a consistent order. Eris separates ordering from execution, lets the network establish the order, and merges replication and transaction coordination into one protocol. All nodes are assumed to be in one datacenter.

Worth knowing first: two-phase commit, two-phase locking, strict serializability, and the ordered unreliable multicast model of NOPaxos.

## Contribution

- **Multi-sequencing.** The sequencer keeps one counter per destination group, increments those of a message atomically and writes them into the packet as a multi-stamp. Each receiver checks its own number to discard out-of-order packets and detect gaps. The paper shows that one global sequence cannot tell a receiver whether a missing number was meant for it, and that separate per-shard sequencers give no order across shards.
- **Independent transactions in one round trip.** These are one-shot procedures with no cross-shard data dependencies, where each shard reaches the same commit decision alone. The client waits for a majority of each shard, including its Designated Learner, the only replica that executes synchronously.
- **The Failure Coordinator.** A replicated service that recovers or permanently drops lost transactions and manages the epoch change after a sequencer failure.
- **General transactions on top.** A preliminary transaction runs the reads and takes all locks, and a conclusory one commits or aborts. Reconnaissance queries handle unknown read and write sets, "precisely as in Calvin". The paper argues that taking locks in one atomic step rules out deadlock.

## Methodology

The authors implemented Eris in about 7,500 lines of C++, with servers on 9 machines and a Cavium Octeon CN6880 middlebox as sequencer. Experiments used 15 shards of 3 replicas unless noted.

The comparison covers Granola, TAPIR, Lock-Store (two-phase commit, two-phase locking and Multi-Paxos, similar to Spanner) and NT-UR, a nontransactional, unreplicated baseline, all in the same C++ framework. Workloads came from YCSB+T: single-shard SRW, a custom MRMW of independent transactions, and a custom CRMW that needs general transactions. TPC-C used 15 warehouses, 10% multi-participant transactions and H-Store's partitioning, without claiming conformance. Failure tests injected packet drops and a sequencer failover. The paper sketches a proof, with the full proof and a model-checked TLA+ specification in a technical report.

## Findings

These are the authors' reported results.

- **TPC-C.** 221K new-order transactions per second: 7.6 times Lock-Store, 6.38 times TAPIR, 2.75 times Granola, and within 3% of NT-UR.
- **Single-shard ideal case.** 1.26M transactions per second, 4.5 times Lock-Store, 2.9 times TAPIR and 2.5 times Granola. Latency is 99 μs, 48% to 72% lower than the other systems. Throughput and latency are within 10% of NT-UR.
- **Contention.** On the most skewed MRMW workload, Eris beats Lock-Store by 35.0 times and TAPIR by 25.6 times.
- **General transactions.** Moving from MRMW to CRMW costs Eris 28% of its throughput, and Granola more than 50%.
- **Scaling.** Nearly perfect up to the 15 shards tested, while a globally sequenced variant scales poorly.
- **Resilience.** At a 1% drop rate, throughput falls by about 10%. At 10%, it falls below Granola's. After a sequencer failure, normal operation returns in 130 ms and maximum throughput in 300 ms.
- **Sequencer capacity.** The middlebox handles 6.19M packets per second, and an end-host 1.61M.
- **Summary range.** The conclusion gives 4.5 to 35 times the throughput and 72% to 80% lower latency for independent transactions, and 3.6 times for general ones.

## Critical Analysis

The result is strong for what it tests: when transactions fit the independent model, removing coordination from the normal path pays off clearly. The caveats concern how far that reaches.

The paper admits several limits.

- **The model is restrictive.** Conditional updates across shards need general transactions, whose locks also make independent transactions wait.
- **Execution is single-threaded per shard.** Multicore machines can run one partition per core, at the cost of potentially more distributed transactions.
- **The in-switch sequencer is unmeasured.** The hardware was "not yet commercially available", so the limit of 116 destinations is an analysis of a proposed architecture.
- **It is not the fastest design.** RDMA-based systems such as FaRM and DrTM reach higher throughput.

The rest is a reading of the evidence.

- **"Coordination-free" has a narrow scope.** It describes the normal case of independent transactions. Every transaction crosses one system-wide sequencer, which caps the prototype at 6.19M packets per second, and its failure makes replicas in every shard stop for an epoch change.
- **The TPC-C number is the best case.** H-Store's partitioning makes every transaction independent, so the general layer is not exercised there.
- **The headline range is a spread, not an expected gain.** The 35 times comes from extreme skew on a custom workload, which sits awkwardly with "on standard benchmarks", while TPC-C gives 7.6 times against the same system.
- **Some headline numbers lack a stated source.** The prose of section 8 states neither the 3.6 times nor the 80%, and gives 48% to 72% for latency. The conclusion also places general transactions within 10% of the baseline, which that prose does not state either.
- **The comparison is partial.** Lock-Store is not Spanner. Fifteen shards of three replicas make 45 replicas on 9 machines, so replicas share hardware, and the paper does not describe their placement.
- **The failure path is thinly tested.** Drop and failover tests ran on single-shard SRW, so losses needing agreement across shards are not stressed. Designated Learner failure, client failure and reconnaissance queries have no measurements.

## Further Research

- How does multi-sequencing perform on real switches, and at what fan-out do resource limits matter?
- Can the system-wide sequencer be partitioned while keeping the order across shards?
- What does a Failure Coordinator round cost for multi-shard losses as shards are added?
- How do general transactions behave when contention keeps invalidating reconnaissance queries?
- How large is the class of real workloads that fit independent transactions without TPC-C style partitioning?

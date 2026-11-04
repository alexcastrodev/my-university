---
title: "The FuzzyLog: A Partially Ordered Shared Log"
summary: The FuzzyLog replaces the total order of a shared log with a DAG of colored nodes, one color per data shard and one chain per region, and its implementation Dapple lets applications scale, weaken consistency and tolerate network partitions in small amounts of code.
researchArea: Distributed Systems
keywords: shared log, partial order, causal consistency, geo-replication, Skeen's algorithm, chain replication, CRDT
version: 1.0
updatedAt: 2026-11-03
---

## Overview

Shared log systems such as [Corfu](/papers/corfu-shared-log-design-for-flash-clusters) and [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) build control plane services as thin layers over one totally ordered log. In this OSDI 2018 paper, Lockerman and colleagues keep that style of design but argue that a system-wide total order is "expensive, often impossible, and typically unnecessary". A sequencer caps throughput and adds round-trips for distant clients; a total order consistent with linearizability is subject to unavailability during network partitions; and updates to disjoint data need no order at all.

The FuzzyLog is a directed acyclic graph of updates. Colors stand for data shards, and each color is a set of totally ordered chains, one per region, joined by cross-links that record causality. Every region holds a full copy, current for its own chains and possibly stale for the others. With one color in one region, it degenerates to an ordinary shared log.

Worth knowing first: shared logs and state machine replication, causal consistency, the difference between linearizability and serializability, the CAP conjecture, and CRDTs.

## Contribution

- **The abstraction.** A small API: `append` to one or more colors, `sync` to play one color and receive a snapshot ID, and `trim`. A new node gets cross-edges to the last node the client saw in each remote chain.
- **Semantics by scope.** Operations on one color across regions are causally consistent. Within a region they are serializable, and linearizable when they touch a single color.
- **Application designs.** ShardedMap scales by color, AtomicMap adds multi-puts, TXMap reuses Tango's transaction protocol for strict serializability, CRDTMap gives causal+ consistency, and CAPMap gives linearizability without partitions and causal+ consistency during them.
- **Dapple.** Each color lives on one partition of in-memory chainservers, replicated by chain replication. Remote chains arrive as shadow logs through periodic synchronization.
- **A fault-tolerant variant of Skeen's algorithm** for multi-color appends. Leases, fencing and write-ahead logging let another client finish the append if its origin client crashes. Single-color appends take one phase, multi-color appends two, and recovery three.

## Methodology

The authors evaluate the designs on Amazon EC2 c4.2xlarge instances, mostly within one region, with geo-distributed runs between Ohio and Tokyo at 168 ms average ping. Dapple runs with two replicas per partition unless stated otherwise.

The experiments compare Dapple with an emulation of Tango's append protocol built inside Dapple, using five partitions plus one unreplicated sequencer; run AtomicMap with 8-byte keys and values on 8 to 16 chainservers without replication; run CRDTMap on five servers in virtual regions within one EC2 region; run CAPMap over 14 seconds with a simulated partition from second 6 to second 8; and run DappleZK, a ZooKeeper clone, against ZooKeeper in DRAM. For correctness, they wrote conventional proofs and a machine-checked proof in Coq of the recovery protocol, omitted for lack of space.

## Findings

These are the authors' reported results.

- **Applications are small.** ShardedMap takes 193 lines, AtomicMap 201, CRDTMap 284, TXMap 417, CAPMap 424 and DappleZK 1881.
- **The sequencer is the limit in the emulation.** Emulated Tango could not scale beyond four clients. Dapple scaled near-linearly with no multi-color appends, was 2X faster at 1%, matched Tango at 10% and fell behind at 100%, where the required partial order is nearly a total order.
- **AtomicMap scales.** The paper reports over 5.5M puts/sec and nearly 1M 2-key multi-puts/sec on 16 Dapple servers.
- **Load becomes staleness.** A spike in CRDTMap puts did not slow gets at the reader and appeared as staleness instead.
- **CAPMap switches modes.** Without a partition both regions were strongly consistent, and the secondary paid the 168 ms round trip. During the partition the secondary moved to a local chain with much lower latency and weaker consistency, while the primary kept strong consistency.
- **DappleZK.** The abstract gives 3M/sec single-key writes and 150K/sec atomic cross-shard renames on 6 nodes. ZooKeeper provided 36K and 66K ops/s with one and two partitions.

## Critical Analysis

The central result is credible: when a workload partitions well, removing the global sequencer removes its bottleneck. The evidence for the wider claims is more uneven.

Limits the paper states itself:

- **The AtomicMap numbers are unreplicated.** The paper admits the deployment ran without replication because of EC2 instance limits. Durability is also an assumption: the chainservers are in-memory, and the implementation relies on battery-backed DRAM.
- **Failure is mostly argued.** A crashed client blocks the involved colors until recovery, and the paper admits a latency spike and possible livelock. Recovery is measured only as latency on a lightly loaded deployment, and replicated partitions are assumed not to fail.
- **The ZooKeeper gap is discounted by the authors.** They expect the single-partition win to come largely from Rust against Java and from prototype against production code, and renames on ZooKeeper were emulated with a delete and a create.

Points that follow from reading the evaluation:

- **The Tango comparison is an emulation.** The paper concludes that centralized sequencers in existing shared logs fundamentally limit scalability, but the experiment shows a sequencer bottleneck inside Dapple, not the behavior of Tango or [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log), which the paper places in the same class. The advantage is also gone by 10% multi-color appends.
- **"Impossible" is narrower than it sounds.** It means unavailable during a partition. In the motivation, the sequencer rates required are arithmetic over assumed bandwidth and payload sizes, set against published measurements of real sequencers.
- **AtomicMap's guarantee is stated two ways.** The introduction calls it linearizable, while Section 4.1 says it is serializable, not linearizable or strictly serializable.
- **The partial order hands work to the application.** The scaling requirement assumes load balanced evenly across colors, and the evaluation does not test skew. `sync` plays one color, so the API as described offers no snapshot across colors, the property [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log) draws from its total order.
- **The geo evidence is thin.** CRDTMap ran in virtual regions, and CAPMap across two regions with a two-second partition. Storage overhead is not reported, although space efficiency is a stated requirement.

## Further Research

- A replicated, durable rerun of the AtomicMap experiment at the same scale.
- Handling hot colors, for example by moving or splitting a color across partitions.
- Whether snapshots across colors can be offered without bringing back global coordination.
- Causal consistency across shards, which the authors sketch as COPSMap and leave for future work.
- CAPMap with more than two regions and with failure of the primary region.

---
title: "ZooKeeper: Wait-free Coordination for Internet-scale Systems"
summary: Yahoo!'s ZooKeeper is a replicated coordination kernel that exposes wait-free data nodes with FIFO client order and linearizable writes, serves reads from local replicas, and lets applications build locks, barriers, group membership and leader election on the client side.
researchArea: Distributed Systems
keywords: zookeeper, coordination service, wait-free, zab, atomic broadcast, watches, leader election, FIFO client order
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

In this paper, we describe ZooKeeper, a service for coordinating processes of distributed applications. Since ZooKeeper is part of critical infrastructure, ZooKeeper aims to provide a simple and high performance kernel for building more complex coordination primitives at the client. It incorporates elements from group messaging, shared registers, and distributed lock services in a replicated, centralized service. The interface exposed by ZooKeeper has the wait-free aspects of shared registers with an event-driven mechanism similar to cache invalidations of distributed file systems to provide a simple, yet powerful coordination service.

The ZooKeeper interface enables a high-performance service implementation. In addition to the wait-free property, ZooKeeper provides a per client guarantee of FIFO execution of requests and linearizability for all requests that change the ZooKeeper state. These design decisions enable the implementation of a high performance processing pipeline with read requests being satisfied by local servers. We show for the target workloads, 2:1 to 100:1 read to write ratio, that ZooKeeper can handle tens to hundreds of thousands of transactions per second. This performance allows ZooKeeper to be used extensively by client applications.

## Overview

Large distributed applications need configuration, group membership, leader election and locks. Google's [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) answered this with a lock service, and locks can build the rest. The Yahoo! authors (Hunt, Konar, Junqueira and Reed) made the opposite choice at ATC 2010: instead of server-side primitives, ZooKeeper exposes a small file-system-like API over wait-free data objects and lets applications assemble their own primitives. Blocking operations such as locks were left out of the API because a slow or faulty client could hold up faster ones.

Wait-freedom alone does not give coordination, so the paper pairs it with ordering guarantees. Writes are linearizable, in the sense of [Herlihy and Wing](/papers/linearizability-correctness-condition-concurrent-objects). Each client's requests run in FIFO order. Reads are not linearizable: they are served by whatever replica the client is connected to. Underneath, writes are totally ordered by an atomic broadcast protocol, Zab, in the spirit of the [state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial) and related to [Paxos](/papers/paxos-made-simple).

Worth knowing first: replicated state machines, quorums, and the difference between linearizability and weaker orderings.

## Contribution

- **A coordination kernel.** A hierarchical namespace of znodes (regular or ephemeral, optionally sequential), with create, delete, exists, getData, setData, getChildren and sync, and no open or close. Updates take an expected version for conditional writes.
- **Two ordering guarantees.** Linearizable writes and FIFO client order. The paper calls its variant A-linearizability: a client may have several outstanding operations, and the system still respects the order in which the client issued them.
- **Watches.** One-time triggers that tell a client that data changed, without giving the new value, so clients can cache without the server managing the cache.
- **Recipes.** Configuration management, group membership, rendezvous, simple locks, locks without the herd effect, read/write locks and double barriers, all implemented at the client.
- **Experience.** Uses at Yahoo! (the Fetching Service and the Yahoo! Message Broker) and in Katta, a non-Yahoo! distributed indexer, plus a performance evaluation.

## Methodology

The paper combines API design, a description of the implementation and a measured evaluation. The server keeps the whole data tree in memory, replicated on every server, with a write-ahead log forced to disk before changes are applied and periodic "fuzzy" snapshots taken without locking the tree. Writes go to a leader, which turns each request into an idempotent transaction and broadcasts it with Zab. Because transactions are idempotent, Zab may redeliver messages during recovery as long as it keeps the order.

The evaluation ran on a cluster of 50 servers (Xeon dual-core 2.1GHz, 4GB RAM, gigabit ethernet, two SATA disks). Thirty-five machines simulated 250 simultaneous clients using the asynchronous Java API, each with at least 100 requests outstanding, reading or writing 1K of data. The experiments cover throughput of a saturated system, injected failures (a five-server ensemble at a constant 30% writes), request latency with a benchmark modeled after Chubby's, and barrier performance.

## Findings

- **Reads scale with servers, writes do not.** At 100% reads, throughput was 87k operations per second with 3 servers and 460k with 13. At 0% reads it fell from 21k with 3 servers to 8k with 13, because every write goes through atomic broadcast.
- **Load distribution matters.** When clients were forced to connect only to the leader, as in Chubby, throughput was much lower, even for write-dominant workloads.
- **Fast recovery.** In the failure experiment ZooKeeper took less than 200ms to elect a new leader, and a failed follower reduced throughput only by the share of reads it had been serving.
- **Latency.** A single worker saw an average request latency of 1.2ms with three servers and 1.4ms with nine. Create throughput was more than 3 times the published Chubby figure.
- **Barriers.** With 50 to 200 clients and 200 to 1600 barriers, the time grew roughly linearly with the number of barriers, and barrier throughput stayed between 1,950 and 3,100 operations per second.
- **Pipelining pays off.** Updating 5000 znodes at about 2 milliseconds each takes 10 seconds one by one, but less than a second when issued asynchronously.
- **Workloads.** The Fetching Service saw read to write ratios between 10:1 and 100:1 above 1,000 operations per second.

## Critical Analysis

- **Reads can be stale.** The paper says plainly that a read may return an old value even if a newer update was committed. The remedy is sync followed by a read, which costs roughly a light write. Applications must know where they depend on this.
- **Guarantees were chosen for the workload.** The design fits read-heavy use at the sizes tested; the write numbers show that larger ensembles trade write throughput for fault tolerance.
- **Performance is not yet tuned.** The authors say their focus so far was correctness and robustness, and mention extra copies and repeated serialization as obvious costs.
- **Failure model.** Servers are assumed to crash and recover. Byzantine faults are not handled, though checksums and sanity checks catch some non-malicious ones, and the authors report no production faults that a Byzantine-tolerant protocol would have prevented. For that setting see [PBFT](/papers/practical-byzantine-fault-tolerance).
- **Evaluation scope.** One cluster type and one benchmark family, with a comparison to Chubby based on its published numbers rather than a head-to-head test.
- **Book vs today.** The paper's separation between a data-model kernel and client-side recipes became a widely used pattern, while later systems such as [Raft](/papers/raft-understandable-consensus-algorithm)-based stores moved toward consistent reads as an option.

## Further Research

- Removing the cost of stale reads without losing local reads, for example with leases on replicas.
- Raising write throughput by partitioning data across ensembles, a tradeoff the paper mentions from Gray et al.
- A fully Byzantine fault-tolerant ZooKeeper without changing the server code base, as the paper cites.
- Easier-to-understand replacements for Zab, such as [Paxos](/papers/paxos-made-simple) variants and Raft.
- Correct client-side recipes for locks and barriers, since subtle mistakes are easy to make.

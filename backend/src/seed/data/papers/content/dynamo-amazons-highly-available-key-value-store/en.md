---
title: "Dynamo: Amazon's Highly Available Key-value Store"
summary: DeCandia and colleagues describe Dynamo, the always-writeable key-value store behind Amazon's shopping cart and other core services, which combines consistent hashing, vector clocks, sloppy quorums, hinted handoff, Merkle trees and gossip to stay available by giving up strong consistency.
researchArea: Distributed Systems
keywords: dynamo, key-value store, eventual consistency, consistent hashing, vector clocks, sloppy quorum, gossip
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Reliability at massive scale is one of the biggest challenges we face at Amazon.com, one of the largest e-commerce operations in the world; even the slightest outage has significant financial consequences and impacts customer trust. The Amazon.com platform, which provides services for many web sites worldwide, is implemented on top of an infrastructure of tens of thousands of servers and network components located in many datacenters around the world. At this scale, small and large components fail continuously and the way persistent state is managed in the face of these failures drives the reliability and scalability of the software systems.

This paper presents the design and implementation of Dynamo, a highly available key-value storage system that some of Amazon's core services use to provide an "always-on" experience. To achieve this level of availability, Dynamo sacrifices consistency under certain failure scenarios. It makes extensive use of object versioning and application-assisted conflict resolution in a manner that provides a novel interface for developers to use.

## Overview

By 2007 Amazon ran a platform of hundreds of services on tens of thousands of servers, and the authors argue that a relational database was a poor fit for many of them: shopping carts, session state, best-seller lists and product catalogs only need primary-key access, and the replication offered by databases usually chooses consistency over availability. Dynamo is the answer: a store where a write is almost never refused, even during disk failures, network partitions or the loss of a data center.

The design deliberately sits on the availability side of the trade-off that [Brewer's conjecture](/papers/brewers-conjecture-cap-feasibility-web-services) later formalized as CAP. Where [Paxos](/papers/paxos-made-simple), [Raft](/papers/raft-understandable-consensus-algorithm) and systems such as [Spanner](/papers/spanner-globally-distributed-database) and [FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store) keep one agreed order of updates and pay for it with unavailability on the minority side of a partition, Dynamo lets replicas diverge and repairs them later. Its vector clocks are a descendant of the logical clocks in [Time, Clocks, and the Ordering of Events](/papers/lamport-time-clocks-ordering-of-events). The paper is a production report: the authors say its main contribution is the evaluation of how well-known techniques can be combined into one highly available system, and that an eventually-consistent store can run demanding applications in production.

Worth knowing first: hash rings (consistent hashing), quorums and the meaning of "eventual consistency", and why concurrent updates need a way to detect that neither one came before the other.

## Contribution

- **An "always writeable" design point.** Conflict resolution is pushed to reads, so writes are never rejected. The paper names two choices for who resolves a conflict: the store (simple policies such as "last write wins") or the application (for example merging shopping carts).
- **Partitioning with virtual nodes.** Keys are hashed with MD5 to 128 bits and placed on a ring. Each physical node owns several positions ("tokens"), which spreads load when a node leaves or joins and lets stronger machines take more.
- **Replication with a preference list.** Each key is stored on N nodes, the coordinator and its N-1 clockwise successors, skipping positions so that the list holds distinct physical nodes and, in practice, several data centers.
- **Versioning with vector clocks.** Every write creates a new immutable version tagged with a list of (node, counter) pairs. The system discards versions that a newer one descends from and hands the client all the others for semantic reconciliation.
- **Tunable quorums (N, R, W).** A read waits for R replies and a write for W, so a service picks its own point between latency, durability, consistency and availability.
- **Sloppy quorum and hinted handoff** for temporary failures, **Merkle-tree anti-entropy** for permanent ones, and **gossip** for membership and failure detection, with no central coordinator.

## Methodology

The first half is a design description: the system interface (get(key) returns an object or a list of conflicting versions plus an opaque context, put(key, context, object) writes it), the ring, the replication rule, the vector clock example with versions D1 to D5, and how reads and writes run, including read repair. Section 4 also explains how a node that is down is replaced by the next healthy node in the preference list, which keeps a hint and hands the replica back later, and how two nodes find divergent keys by comparing Merkle tree roots and walking down the branches that differ.

The second half reports experience from running Dynamo in production. The implementation is in Java, with a pluggable local storage engine (Berkeley DB Transactional Data Store, BDB Java Edition, MySQL, or an in-memory buffer with a persistent backing store). Measurements come from live systems running a (3,2,2) configuration on a couple hundred nodes, and some absolute numbers are withheld as business-sensitive. The paper compares three partitioning strategies on a system with 30 nodes and N=3, and compares server-driven with client-driven coordination.

## Findings

- **Latency.** A typical SLA is 99.9% of reads and writes within 300 ms. The 99.9th percentile latencies are around 200 ms and about an order of magnitude above the averages, and writes are slower than reads because they always reach the disk.
- **Write buffering.** An in-memory object buffer lowered the 99.9th percentile latency by a factor of 5 at peak traffic, even with a buffer of a thousand objects, at the cost of durability. To reduce that risk the coordinator picks one of the N replicas to do a durable write while still waiting only for W replies.
- **Divergent versions are rare.** For the shopping cart over 24 hours, 99.94% of requests saw exactly one version, 0.00057% saw two, 0.00047% saw three and 0.00009% saw four. The authors attribute growth in divergence mostly to concurrent writers, usually automated clients, not to failures.
- **Partitioning.** Strategy 3 (Q/S tokens per node, equal-sized partitions) had the best load-balancing efficiency and cut the membership metadata kept at each node by three orders of magnitude compared with Strategy 1 (T random tokens per node), and it made bootstrapping and archival simpler. The load imbalance ratio was as high as 20% at low load and close to 10% at high load.
- **Client-driven coordination** cut the 99.9th percentile read and write latency from 68.9 and 68.5 ms to 30.4 ms, and the averages from 3.9 and 4.02 ms to 1.55 and 1.9 ms, by removing the load balancer and an extra hop. Clients refresh membership every 10 seconds.
- **Availability.** Over about two years of use by internal services, applications received successful responses for 99.9995% of requests and no data loss event had occurred. During the holiday season the shopping cart service handled tens of millions of requests and over 3 million checkouts in a day.

## Critical Analysis

The paper is honest about its trade-offs, and its influence on the NoSQL generation was large, but its evidence has limits.

- **The workload is narrow and the data is partial.** The evaluation is from Amazon's own production systems with absolute request rates and outage lengths withheld, so it cannot be reproduced, and there is no comparison against another store.
- **Shifting conflicts to developers is a real cost.** The paper itself notes that deleted items can resurface in a merged cart, and that new applications need early analysis to choose a reconciliation method. Many teams later found that "last write wins" with physical timestamps silently loses updates.
- **Vector clock truncation is unexamined.** The scheme drops the oldest pair after about 10 entries, which can make descent relations inexact, but the authors report only that the problem "has not surfaced in production".
- **Limits of scale and trust.** Every node gossips the full routing table, which the authors say works for a couple of hundred nodes and not for tens of thousands, and the system assumes a non-hostile environment with no authentication.
- **R + W > N does not give strong consistency.** With sloppy quorums, hinted handoff and no single order of writes, the quorum only makes stale reads less likely, a point that is easy to miss when comparing with the linearizable behavior defined in [Linearizability](/papers/linearizability-correctness-condition-concurrent-objects).

Book versus today: Amazon's later managed service (DynamoDB) has a different design and offers stronger options, so the 2007 paper describes the ancestor and not the current product, while Cassandra and Riak took the ring, quorum and gossip ideas more directly.

## Further Research

- Conflict-free replicated data types and other merge-friendly structures that remove the need for hand-written reconciliation.
- Stronger guarantees on top of the same ring, such as causal consistency and transactions, without giving up availability.
- Hierarchical or partial-membership designs that scale gossip and routing beyond a few hundred nodes.
- Better failure detection and repair scheduling, including admission control between background and foreground work.
- Formal and testing-based checks of eventually-consistent stores, including Jepsen-style fault injection.

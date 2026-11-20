---
title: "Designing Distributed Systems Using Approximate Synchrony in Data Center Networks"
summary: The paper treats a data center as an approximately synchronous network, builds Mostly-Ordered Multicast out of routing and priority queues, and uses it in Speculative Paxos, which executes requests before agreement and commits in two message delays when the network keeps the order.
researchArea: Distributed Systems
keywords: approximate synchrony, mostly-ordered multicast, speculative paxos, state machine replication, data center networks, software-defined networking, speculation and rollback
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Distributed systems are traditionally designed independently from the underlying network, making worst-case assumptions (e.g., complete asynchrony) about its behavior. However, many of today's distributed applications are deployed in data centers, where the network is more reliable, predictable, and extensible. In these environments, it is possible to co-design distributed systems with their network layer, and doing so can offer substantial benefits. This paper explores network-level mechanisms for providing Mostly-Ordered Multicast (MOM): a best-effort ordering property for concurrent multicast operations. Using this primitive, we design Speculative Paxos, a state machine replication protocol that relies on the network to order requests in the normal case. This approach leads to substantial performance benefits: under realistic data center conditions, Speculative Paxos can provide 40% lower latency and 2.6× higher throughput than the standard Paxos protocol. It offers lower latency than a latency-optimized protocol (Fast Paxos) with the same throughput as a throughput-optimized protocol (batching).

## Overview

Replication protocols such as [Paxos](/papers/paxos-made-simple) and [Viewstamped Replication](/papers/viewstamped-replication-revisited) assume an asynchronous network where messages may be delayed, dropped or reordered, and they pay for that worst case with extra message delays and with a leader that handles every message. Services like [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) and [Spanner](/papers/spanner-globally-distributed-database) run these protocols inside data centers, where the topology is structured, congestion loss can be made unlikely with priorities, and one operator controls the switches.

This NSDI 2015 paper, from the University of Washington, argues that a data center is better modelled as approximately synchronous: strong ordering in the common case, occasionally violated during failures. The idea has two halves. The network is engineered to deliver concurrent multicasts in a consistent order most of the time, and the protocol on top assumes that order, stays correct when it breaks, and recovers when it does.

Worth knowing first: state machine replication (see the [state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial)), linearizability, and why [FLP](/papers/flp-impossibility-of-distributed-consensus) makes liveness depend on the network.

## Contribution

- **Mostly-Ordered Multicast (MOM).** A best-effort property: if one receiver processes message m before m', other receivers either process them in that order or lose a message. It is empirical, not a guarantee, so applications must tolerate violations.
- **Three network designs.** Topology-aware multicast sends every copy through switches equidistant from all group members, so all copies cross the same number of links. High-priority multicast adds a strict-priority queue for MOM traffic. In-network serialization routes all multicasts of a group through one root switch chosen by the SDN controller. All use OpenFlow rules, and the controller reroutes around failed switches.
- **Speculative Paxos.** Replicas execute each request on arrival and reply with the result plus a summary hash of their log. A client treats the operation as committed when a superquorum of f + ⌈f/2⌉ + 1 replicas out of 2f + 1 send matching replies. A periodic synchronization step promotes entries to committed, and a reconciliation step, structured like a Viewstamped Replication view change, merges logs and rolls back speculation when the order diverged.
- **Safety without the assumption.** The protocol gives linearizability with at most f failures even if the network drops, delays, reorders or duplicates messages. Liveness needs repeated messages to eventually arrive, as in Paxos.

## Methodology

The MOM designs ran on a testbed that emulates 12 switches in a fat tree with five physical switches (four HP ProCurve 6600 and one Arista 7150S-24) and three senders and receivers, and in a packet-level simulator of 2,560 servers and 119 switches, driven by background traffic derived from Microsoft data center measurements. The simulator matched the testbed within 8%.

Speculative Paxos is a C++ library of about 10,000 lines that also implements Paxos, Paxos with batching (the sliding-window strategy of PBFT, batches up to 64) and Fast Paxos. Experiments used three replicas (f = 1) on the testbed with 2 to 300 closed-loop clients, then three nodes behind one switch with artificial packet reordering. Three applications were built: a timestamp server, a lock manager and a transactional key-value store with two-phase commit, tested with a microbenchmark and a Retwis-based workload under a 10 ms SLO.

## Findings

These are the authors' reported results. Items marked as chart reading come from figures only.

- **Reordering of multicast.** On the testbed, conventional IP multicast reordered as many as 25% of packets. Topology-aware MOM cut this by 2 to 3 orders of magnitude (the paper puts the first two designs at about 0.01% to 0.1%), and in-network serialization eliminated it. No single switch reordered traffic, even at link-saturating rates. In simulation, topology awareness gave an order of magnitude, QoS more, and serialization left only congestion loss. For serialization, latency skew between receivers stayed under 2.5 µs.
- **Latency.** At low to medium load, 135 µs for Speculative Paxos, 220 µs for Paxos and 171 µs for Fast Paxos (median, three replicas).
- **Throughput.** About 100,000 requests/s for Speculative Paxos against about 38,000 for Paxos and Fast Paxos. Batching reaches an equivalent peak, but at 90,000 requests/s its latency is 3.5 times higher.
- **Reordering sensitivity.** With rare reordering, 3× the throughput of Paxos and Fast Paxos. It stays ahead of Paxos until the reorder rate exceeds 0.1%. Chart reading of Figure 9: at 1% reordering it falls to under 10,000 requests/s, below Paxos at roughly 28,000.
- **Applications.** Rollback code is 10 of 154 lines (timestamp server), 75 of 606 (lock manager) and 248 of 2,011 (key-value store). A transaction commits in 1.01 ms, against 1.44 ms for Paxos and 1.12 ms for Fast Paxos. Under the 10 ms SLO, chart reading of Figure 10 puts maximum throughput near 5,800 transactions/s for Speculative Paxos, 4,800 with batching, 2,900 for Fast Paxos and 2,000 for Paxos.

## Critical Analysis

The paper states its own limits: speculation needs rollback support from the application, reconciliation is costlier than a Fast Paxos conflict, and the protocol is slower in conflict-heavy environments. It suggests exploiting commuting operations, as [Egalitarian Paxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments) does, to tolerate more reordering.

The following points are a reading of the evidence, not claims of the paper.

- **Correctness does not depend on synchrony, performance does.** The 3× gain holds only while reordering stays under about 0.1%, and the testbed puts the first two MOM designs at 0.01% to 0.1%, right at that edge, with only serialization removing reordering outside failures.
- **Terms the paper does not use.** It builds no synchronized clocks and does not state bounded latency as a property. Its model is ordering, supported by measured queuing bounds (about 1.2 µs per link, 2.4 µs core to ToR).
- **Small deployment.** The protocol runs with three replicas, where the superquorum is all three, so by my reading any single replica failure leaves the fast path. The text says speculative processing needs fewer than ⌈f/2⌉ failures.
- **Failures and scope.** Switch failure handling is described (controller reroute, a few milliseconds citing other work) but not measured end to end with Speculative Paxos, and the single serialization switch is a design choice, not a tested failure case. Geo-distributed replication is not covered, since the argument depends on one administrative domain.
- **Inconsistent counts.** The text says the simulation has 119 switches, while the Figure 5 caption says 160 switches.

Later literature, checked against the source text: [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) (OSDI 2016, partly the same authors) says Speculative Paxos assumes only best-effort ordering and that NOPaxos instead needs an ordering guarantee from a programmable data plane. Its evaluation reports Speculative Paxos throughput dropping substantially after 0.5% packet drops and falling to Paxos at 1%. I did not read [Eris](/papers/eris-coordination-free-consistent-transactions) or [Hydra](/papers/hydra-serialization-free-network-ordering) beyond their catalog summaries.

## Further Research

- How much does a real production network reorder MOM traffic over months, including during switch failures?
- Exploiting commuting operations to raise the tolerable reordering rate, as the paper suggests.
- Larger groups where the superquorum is smaller than the whole group.
- Whether a guaranteed order, as in NOPaxos, is worth the extra switch capability compared with best-effort ordering.

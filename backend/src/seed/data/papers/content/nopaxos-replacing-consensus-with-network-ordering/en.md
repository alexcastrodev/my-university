---
title: "Just Say NO to Paxos Overhead: Replacing Consensus with Network Ordering"
summary: NOPaxos splits state machine replication between a network that orders messages without guaranteeing delivery and a protocol that deals only with lost messages, which on a prototype sequencer reaches throughput within 2% and latency within 16 μs of an unreplicated system.
researchArea: Distributed Systems
keywords: nopaxos, state machine replication, ordered unreliable multicast, network sequencing, software-defined networking, consensus, data centers
version: 1.0
updatedAt: 2026-11-03
---

## Overview

State machine replication keeps a service available by having replicas apply the same operations in the same order. Protocols like [Paxos](/papers/paxos-made-simple) assume a network that may lose or reorder anything, so they coordinate on every request. Atomic broadcast would make replication trivial, but it is equivalent to consensus and only moves the cost to another layer.

This OSDI 2016 paper from the University of Washington looks for the middle ground. It splits replication into ordering and reliable delivery and hands only ordering to the network, leaving the protocol a smaller job: deciding which requests to execute and which to skip. The design targets a single data center with a software-defined network.

Worth knowing first: the normal case of Multi-Paxos, linearizability, and the idea of a programmable switch.

## Contribution

- **Ordered unreliable multicast (OUM).** All receivers of a group get messages in the same order, messages may be lost, and receivers are notified of a drop. The guarantees hold within a session, which ends if the sequencer fails.
- **Three sequencers.** A P4 program for programmable switches, a Cavium Octeon middlebox and a Linux program. All packets of a group pass through the sequencer, which stamps each one with a counter.
- **The normal case.** Every replica logs the request and replies, and only the leader executes it. The client waits for f + 1 matching replies, including the leader's, so a request takes one round trip with no messages between replicas.
- **Gap agreement.** After a drop notification, a replica asks the leader for the request. If the leader missed it too, it commits a NO-OP in that log slot and waits for f replies.
- **View change.** A view pairs a leader number with a session number, so one mechanism covers leader failure and the end of a session.
- **A simple majority.** Because order is guaranteed, clients need no superquorum, unlike Fast Paxos and Speculative Paxos.

## Methodology

The authors implemented NOPaxos in about 5,000 lines of C++. The testbed emulates a 12-switch fat tree on three physical switches, with the Cavium sequencer attached to the root switches and five replicas (3 to 9 in the scalability test). The baselines are Paxos, Fast Paxos, Paxos with batching, Speculative Paxos and an unreplicated system.

Experiments cover latency and throughput with closed-loop clients, random packet drops, a sequencer failure simulated by notifying the controller, and a transactional key-value store (two-phase commit with optimistic concurrency control) under a Retwis-based workload and a 10 ms SLO. A packet-level simulation of 2,560 end-hosts and 119 switches estimates the routing cost. The paper sketches a correctness proof and leaves the full proof and a TLA+ specification to a technical report.

## Findings

These are the authors' reported results, with NOPaxos on the Cavium sequencer unless noted.

- **Close to unreplicated.** Throughput within 2% and latency within 16 μs of the unreplicated system.
- **Against other protocols.** Latency of 111 μs, against 240 μs for Paxos and 193 μs for Fast Paxos. Throughput of 4.7 times that of Paxos and 24% above Speculative Paxos.
- **Sequencer cost.** The middlebox adds 8 μs at the median and 16 μs at the 99th percentile, a separate measurement from the gap above. An end-host sequencer costs 36% more latency.
- **Packet loss.** At a 1% drop rate, NOPaxos stays roughly level with the unreplicated system, while Speculative Paxos falls to the throughput of Paxos.
- **Replica count.** NOPaxos keeps its throughput as replicas are added, while Paxos and Fast Paxos degrade in proportion to the replica count.
- **Sequencer failover.** Throughput drops to zero, normal operation resumes after about 110 ms, and peak throughput after about 270 ms. Most of the delay is the route update.
- **Application.** The key-value store gets more than 4 times the throughput of Paxos, 45% more than Speculative Paxos, and comes within 4% of the unreplicated system.
- **Routing cost (simulation).** In 88% of cases, routing through the sequencer added no latency to reach a quorum of 3 out of 5 receivers.

## Critical Analysis

The central idea is well supported: ordering is cheap to provide and removes most of the protocol's work. The headline claims need more care.

The paper states some limits itself.

- **The in-switch sequencer is not measured.** Without the hardware, "we cannot evaluate their performance". The near-zero-cost claim rests on an analogy with switches that write timestamps, and every measured number comes from a middlebox. The [Eris](/papers/eris-coordination-free-consistent-transactions) paper, a year later, says the hardware for its own related sequencer is "not yet commercially available".
- **Safety depends on the network.** It holds "provided the OUM guarantees continue to hold", under a crash-only failure model.

The rest is a reading of the evidence.

- **Consensus moves, it does not disappear.** The controller is replicated with Paxos, and gap agreement and view changes are coordination. What goes away is coordination on the common path, which the title overstates.
- **The conclusion goes beyond the numbers.** It calls latency equivalent to an unreplicated system, "proving that replication does not have to come with a performance cost". Yet 16 μs is about 14% of NOPaxos's 111 μs, and section 6.1 describes neither the replicated operation nor any use of stable storage, so the 2% may not transfer to costlier operations.
- **Failover looks optimistic.** Section 4.3 expects rerouting "within a few milliseconds", but measured recovery takes about 110 ms, mostly in the route update. The failure was simulated by notifying the controller, so detection time is excluded.
- **The failure tests are narrow.** Leader failure, view change cost and synchronization overhead are not measured. Section 6.2 claims resilience to "packet drops and reorderings", but only random drops were injected, up to 1%.
- **One group only.** The key-value store still uses two-phase commit across shards, and Eris later argues that OUM is not suited to ordering across shards.

## Further Research

- How does a real in-switch sequencer compare with the projection here?
- How far can failover shrink once detection and route updates are both measured?
- How does OUM behave under correlated loss and real background traffic?
- How does recovery after a leader crash grow with the unsynchronized log?
- Can a similar ordering guarantee exist without control of the network, or across data centers?
- What happens to safety if a sequencer misbehaves instead of crashing?

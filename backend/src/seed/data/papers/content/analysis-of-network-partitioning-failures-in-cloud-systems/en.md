---
title: "An Analysis of Network-Partitioning Failures in Cloud Systems"
summary: An OSDI 2018 study of 136 failures triggered by network partitions in 25 widely used distributed systems finds that 80% are catastrophic, 88% need only one isolated node and 29% come from partial partitions, and presents NEAT, a fault-injection framework that found 32 new failures in seven systems.
researchArea: Distributed Systems
keywords: network partition, partial partition, simplex partition, failure study, fault injection, NEAT, leader election, CAP theorem
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

We present a comprehensive study of 136 system failures attributed to network-partitioning faults from 25 widely used distributed systems. We found that the majority of the failures led to catastrophic effects, such as data loss, reappearance of deleted data, broken locks, and system crashes. The majority of the failures can easily manifest once a network partition occurs: they require little to no client input, can be triggered by isolating a single node, and are deterministic. However, the number of test cases that one must consider is extremely large. Fortunately, we identify ordering, timing, and network fault characteristics that significantly simplify testing. Furthermore, we found that a significant number of the failures are due to design flaws in core system mechanisms. We found that the majority of the failures could have been avoided by design reviews, and could have been discovered by testing with network-partitioning fault injection. We built NEAT, a testing framework that simplifies the coordination of multiple clients and can inject different types of network-partitioning faults. We used NEAT to test seven popular systems and found and reported 32 failures.

## Overview

This OSDI 2018 paper (Carlsbad), by Ahmed Alquraan, Hatem Takruri, Mohammed Alfatafta and Samer Al-Kiswany of the University of Waterloo, asks a narrow question: network partitions are a well-studied fault, so why do they still break production systems? The authors cite network studies that put partitions at about once a week, lasting tens of minutes to hours. They study the failure end to end, from the sequence of events to the user-visible effect.

The theoretical backdrop is the CAP theorem of Gilbert and Lynch ([Brewer's Conjecture](/papers/brewers-conjecture-cap-feasibility-web-services)): during a partition a system must choose between availability and consistency. The paper does not revisit the theorem. It shows that real systems fail even where the choice was made, through flaws in leader election, reconfiguration and recovery. It is the partition-specific sibling of [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) (cited as Yuan et al.) and shares its method. Catalog context, my pairing and not the paper's: [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) is about failures that detectors miss, while here the detector's verdict "unreachable means crashed" is the premise that breaks.

## Contribution

- **A corpus of 136 failures in 25 systems**, with the manifestation sequence of each (events, order, timing, node count, partition type).
- **Thirteen findings.** The paper presents them as 13 main findings for designers, developers, testers and administrators.
- **A taxonomy of partitions** (complete, partial, simplex), with the first study, to the authors' knowledge, of the impact of partial partitions on modern systems.
- **NEAT**, a Java testing framework that creates and heals the three partition types and coordinates clients with a global operation order.
- **Evidence that tests are cheap:** 32 new failures found in seven systems with tests of about 30 lines each.

## Methodology

The 136 failures come from three sources: 88 tickets from public issue trackers, 16 Jepsen reports (of the 25 Jepsen blog posts, those about the studied systems), and 32 failures found by NEAT. The 25 systems are MongoDB, VoltDB, RethinkDB, HBase, Riak, Cassandra, Aerospike, Geode, Redis, Hazelcast, Elasticsearch, ZooKeeper, HDFS, Kafka, RabbitMQ, MapReduce, Chronos, Mesos, Infinispan, Ignite, Terracotta, Ceph, MooseFS, ActiveMQ and DKron.

Ticket selection: keyword search ("network partition", "split-brain", "isolation" and others), tickets from 2011 or later, no "Minor" or "Trivial" priority. Failures that a plain node crash can also trigger were excluded, so both sides of the partition must be running. For each ticket the authors read the description, logs, discussion, patch and unit tests, and reproduced 24 failures (13 from trackers, 11 from Jepsen). Two reviewers classified each failure independently. The stated limits are representativeness (25 systems), sampling bias toward high-impact tickets, and observer error.

## Findings

- **Impact (F1-F3).** 80% of the failures are catastrophic (data loss 26.6%, stale read 13.2%, broken locks 8.2%, crash or hang 8.1%, unavailability 6.6%, reappearing deleted data 6.6%, corruption 5.1%, dirty read 5.1%); the table counts 104 of 136. 90% are silent, and 21% leave damage that persists after the partition heals.
- **Mechanisms (F4).** Leader election is involved in 39.7% of the failures, then configuration change (19.9%), data consolidation (14.0%) and request routing (13.2%). The most common election flaw is overlap between successive leaders (57.4%), then electing a bad leader (20.4%).
- **Partition types (F6).** Complete 69.1%, partial 28.7%, simplex 2.2%; 99% of the failures need a single partition. Examples include MongoDB and Elasticsearch leader thrashing and double leaders through a node that sees both sides.
- **Client access (F5).** 28% need no client access, 36% only one side, 36% both sides.
- **Ease of manifestation (F7-F9).** 12.6% need nothing but the partition. By Table 7, 83% need at most four events counting the partition; all multi-event failures need a specific order, but 84% start with the partition. 88% manifest by isolating one node, 45% any replica.
- **Timing and determinism (F10).** 62% are deterministic and 18% have known timing constraints (80%); 7% are nondeterministic.
- **Resolution (F11).** 47% required redesigning a mechanism: design flaws took 205 days on average to resolve, implementation bugs 81 days.
- **Testing (F12-F13).** All failures reproduce on five nodes, 83% on three. 93% can be reproduced by tests with a fault-injection framework.

NEAT is 1553 lines of Java, with a partitioner using OpenFlow (152 lines on Floodlight) or iptables. A test engine runs the workload through Java RMI. It tested Ceph, Ignite, Terracotta, DKron, ActiveMQ, Infinispan and MooseFS and found 32 failures, 30 of them catastrophic.

## Critical Analysis

Strengths: manual, double-reviewed analysis of real tickets, honest limitations, and findings that translate into tests (isolate a leader, test on three nodes, issue operations right after the partition).

Limits that the paper itself states: tickets are biased toward important ones, and failures a crash could cause were left out, so the percentages describe partition-only failures and not all outages. The comparison with Yuan et al. (24% catastrophic) is flagged by the authors as not directly comparable.

What the paper does not claim: it does not give failure rates in production, does not show that a given system is unsafe today (versions date from 2018 or earlier), and does not prove that design reviews would have caught the failures. It says "We expect" that. It proposes no fix for partial partitions, only calls for failure models and better failure detectors.

Later literature (marked as such): the same group published "Toward a Generic Fault Tolerance Technique for Partial Network Partitioning" (OSDI 2020). I read only its abstract on the USENIX page: a study of partial-partition failures in 12 systems, and Nifty, an overlay that detours packets around partial partitions. Jepsen, which the paper compares against, is described here only as the paper describes it. See also [Metastable Failures](/papers/metastable-failures-in-distributed-systems).

## Further Research

The authors name two directions: extending NEAT with workload and network-fault generators to automate testing, and fault-tolerance techniques for partial partitions. They also call for more accurate failure detectors, since unreachability is used as a proxy for a crash.

Open questions, my reading and not the paper's: which of the 2018 failures still reproduce on current versions, and how NEAT-style targeted tests combine with the model checking and runtime verification that the authors say their findings can inform. Related catalog work on failure reproduction: [Efficient Reproduction of Fault-Induced Failures](/papers/efficient-reproduction-of-fault-induced-failures-in-distributed-systems). Background on the protocols involved: [Raft](/papers/raft-understandable-consensus-algorithm) and [Paxos Made Live](/papers/paxos-made-live-engineering-perspective), the latter cited by the paper for tweaking proven protocols.

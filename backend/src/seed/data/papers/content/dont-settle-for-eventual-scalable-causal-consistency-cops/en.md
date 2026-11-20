---
title: "Don't Settle for Eventual: Scalable Causal Consistency for Wide-Area Storage with COPS"
summary: COPS is a geo-replicated key-value store that gives causal consistency with convergent conflict handling (causal+) without giving up availability, low latency or scalability, by tracking dependencies between keys and checking them in the receiving datacenter before a replicated write becomes visible. Its COPS-GT variant adds non-blocking get transactions.
researchArea: Distributed Systems
keywords: causal consistency, causal+, geo-replication, key-value store, ALPS, get transactions, dependency tracking
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Geo-replicated, distributed data stores that support complex online applications, such as social networks, must provide an "always-on" experience where operations always complete with low latency. Today's systems often sacrifice strong consistency to achieve these goals, exposing inconsistencies to their clients and necessitating complex application logic. In this paper, we identify and define a consistency model, causal consistency with convergent conflict handling, or causal+, that is the strongest achieved under these constraints. We present the design and implementation of COPS, a key-value store that delivers this consistency model across the wide-area. A key contribution of COPS is its scalability, which can enforce causal dependencies between keys stored across an entire cluster, rather than a single server like previous systems. The central approach in COPS is tracking and explicitly checking whether causal dependencies between keys are satisfied in the local cluster before exposing writes. Further, in COPS-GT, we introduce get transactions in order to obtain a consistent view of multiple keys without locking or blocking. Our evaluation shows that COPS completes operations in less than a millisecond, provides throughput similar to previous systems when using one server per cluster, and scales well as we increase the number of servers in each cluster. It also shows that COPS-GT provides similar latency, throughput, and scaling to COPS for common workloads.

## Overview

This SOSP 2011 paper (Cascais, Portugal) is by Wyatt Lloyd and Michael J. Freedman (Princeton), Michael Kaminsky (Intel Labs) and David G. Andersen (Carnegie Mellon). It was written when large web services had settled on eventual consistency. [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) is the paper's own example: always writable, with conflicts left to the application. Werner Vogels's essay [Eventually Consistent](/papers/eventually-consistent-vogels) explains that trade-off, and [Brewer's Conjecture](/papers/brewers-conjecture-cap-feasibility-web-services) is the CAP proof the paper starts from.

The authors call a system with four properties ALPS: Availability, low Latency, Partition tolerance and high Scalability. An ideal store would add linearizability ([Linearizability](/papers/linearizability-correctness-condition-concurrent-objects)), but the paper recalls that CAP rules it out with availability and partition tolerance, and that low latency is also incompatible with linearizability and with sequential consistency (results it cites, not new ones). So the question becomes the strongest model an ALPS system can still offer.

Worth knowing first: Lamport's happened-before relation ([Time, Clocks, and the Ordering of Events](/papers/lamport-time-clocks-ordering-of-events)), consistent hashing, and chain replication ([Chain Replication](/papers/chain-replication-high-throughput-availability)), which the design builds on.

## Contribution

- **ALPS and causal+.** Causal consistency requires reads to respect potential causality: execution thread order, "gets from" (a read of a value follows the put that wrote it) and transitivity. Convergent conflict handling requires that concurrent puts to one key be handled identically at every replica by an associative and commutative handler, so replicas never diverge for good. The default handler is last-writer-wins.
- **A place on the spectrum.** Causal+ sits between sequential and causal consistency: stronger than causal and per-key sequential, weaker than sequential. The paper says earlier systems such as Bayou and PRACTI believed to be causal were in fact causal+, but none was scalable.
- **Scalable dependency checking.** Every key version carries metadata, and a replicated write is committed in a remote cluster only after its dependencies are committed there. Dependencies may sit on any node of the cluster, whereas earlier systems limited them to one machine.
- **Nearest dependencies.** The client library marks only the dependencies with a path of length one to the write, so a node needs few dep_check calls.
- **Get transactions (COPS-GT).** A read of several keys returns a causal+ consistent snapshot in at most two rounds of local reads, with no locks and no blocking. The paper claims COPS-GT is the first ALPS system to achieve this.

## Methodology

Each datacenter runs a full replica as a cluster, partitioned by consistent hashing and linearizable inside (the design uses chain replication per key). Clients talk only to their local cluster. A put commits locally, returns, and is replicated in the background through put_after, carrying the key, value, dependencies and a version. The version is a Lamport timestamp (the node's clock in the high-order bits, its identifier in the low-order bits), which also yields the last-writer-wins order. The receiving node issues dep_check to the nodes holding the nearest dependencies and commits once all succeed. Each client context allows a single outstanding put.

COPS stores one version and its number per key. COPS-GT keeps several versions with full dependency lists. Its get_trans reads the latest version of every key, computes the newest version of each key implied by the returned dependencies, and re-reads only the stale keys by explicit version, which the paper argues cannot introduce new dependencies. Dependencies are pruned through a never-depend flag (set when a write is committed in all datacenters), a gossiped global checkpoint time and a trans_time of 5 seconds that bounds how long old versions must be kept.

The prototype is about 13,000 lines of C++ over FAWN-KV (about 8,500 lines), with Thrift and Snappy. It runs on 70 servers of the VICCI testbed split into logical datacenters, with full bandwidth between them. It compares COPS, COPS-GT and LOG, the same code without dependency tracking, which stands for log-exchange systems. Trials last 60 seconds (the first and last 15 are dropped) and are run 15 times, reporting the median.

## Findings

- **Microbenchmarks (Table 2, one server per datacenter, 1-byte values).** get_by_version has median latency 0.37 ms in COPS and 0.38 ms in COPS-GT, against 0.26 ms for a Thrift ping, at 52 Kops/s against 60. put_after has median 0.57 ms and 30 Kops/s in COPS, and 0.91 ms and 24 Kops/s in COPS-GT with one dependency. With 130 dependencies COPS-GT gets 1.03 ms and 20 Kops/s. The 99th percentile reaches 7.45 ms and the 99.9th 12.25 ms (ping). The paper says median put_after latency is around 1 ms even with up to 130 dependencies, and each dependency is about 12 bytes.
- **Dependencies drive the cost.** The global checkpoint time lags about 6 seconds, so a client doing 100 puts per second carries about 600 dependencies. COPS-GT must track them all, while COPS keeps 1 to 4 nearest ones and its throughput does not depend on access variance.
- **COPS against COPS-GT.** With default parameters (put:get 1:1, 1024 clients per server, variance 1, 1-byte values) COPS-GT reaches about two-thirds of COPS, a workload the authors chose to be non-ideal. The gap closes with higher inter-operation delay (32K clients per server), put:get 1:16, variance 1/128 or 16KB values. In an "expected workload" (32K clients, 1KB values, 1:16) the two are "very comparable".
- **Scalability.** Throughput almost doubles each time servers per datacenter double (1, 2, 4, 8, 16), for COPS and COPS-GT, and COPS on one server matches LOG. The raw per-bar values in Figure 12 are readable only from the chart (reading the chart), and are not quoted here.
- **Space.** At 105 MB/s of write traffic per node, keeping old versions for trans_time needs about 525 MB of extra buffer per machine.

## Critical Analysis

The paper states several limits itself. COPS-GT is less efficient for write-heavy workloads and less robust to long partitions and datacenter failures, because dependencies on the newest versions cannot be pruned during a partition. A datacenter that fails loses writes not yet replicated out, which the authors call the inevitable cost of fast local writes. A client may have only one outstanding put. Failures are assumed fail-stop and detectable.

The points below are a reading of the evidence, not claims of the paper.

- **No write transactions.** COPS offers single-key puts and get transactions only. The paper itself notes that Walter gives transactional guarantees across keys, including writes, at the price of a wide-area two-phase commit in some cases.
- **Fault tolerance was not evaluated.** The prototype leaves out chain replication and conflict detection (COPS-CD is a design only), and there is no experiment that loses a datacenter or measures replication queues growing during a partition.
- **The testbed hides the wide area.** The experiments use logical datacenters in one cluster with full bandwidth between them, and the text does not describe emulated wide-area delay. The paper argues the 70 ms round trip is about 1% of the roughly 6 s checkpoint lag, but measures no wide-area run.
- **Abstract against tables.** "Less than a millisecond" is a median claim: Table 2 shows 99th percentiles of 3 to 7 ms and 99.9th of 7 to 12 ms.
- **Later literature (not read for this entry, taken from other catalog analyses).** The [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) entry records that its authors left COPS and Eiger out of their comparison because explicit dependency checking looked impractical under partial geo-replication. The [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations) entry classifies causal consistency as only sticky available, which matches COPS clients talking to a single local cluster.

## Further Research

- Write transactions and cross-key atomic updates without a single serialization point.
- Letting a write commit after fewer than all datacenters, which the paper lists as future work.
- Cheaper metadata: the cost of tracking all dependencies for get transactions is what limits COPS-GT on write-heavy workloads.
- Comparing it with [Spanner](/papers/spanner-globally-distributed-database), which (outside this paper) pays wide-area latency to keep strong consistency, and with CRDT-style convergence ([CRDTs](/papers/conflict-free-replicated-data-types)) as the conflict handler; see also [Keeping CALM](/papers/keeping-calm-when-distributed-consistency-is-easy).

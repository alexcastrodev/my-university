---
title: "The LogDrive: Composable Durability for Cloud-Based Shared Logs"
summary: Confluent's Conflux replicates a metadata store over a shared log that lives on cloud storage, keeping durability in a tiny LogDrive layer that composes through striping and quorums and leaving ordering to a separate AtomicLog above it.
researchArea: Distributed Systems
keywords: shared log, cloud storage, logdrive, composable durability, state machine replication, metadata store, quorum
version: 1.0
updatedAt: 2026-11-07
---

## Overview

A growing family of services keeps its data plane directly on cloud object storage and needs a separate metadata service for the index. This OSDI 2026 paper (the 20th USENIX Symposium on Operating Systems Design and Implementation, July 13 to 15, 2026, Seattle), from Confluent, asks what that metadata service should be for K2, a Kafka-compatible publish-subscribe system built over S3. The authors found two bad options: a self-managed stateful database is complex and fragile to operate, while a cloud database such as DynamoDB is simple but, by their estimate, would have taken roughly 75% of K2's overall cost, because metadata means many small writes and repeated reads.

Their answer is Conflux, a state machine replication (SMR) layer whose shared log is stored on cloud storage, so that durability is delegated entirely to the cloud. The obstacle they report is that shared logs compose through chaining and striping but not through replication, since each log assigns its own timestamps to an append. The paper therefore splits the log in two: the LogDrive, a low-level address space that owns durability, and the AtomicLog, a conventional shared log that owns sequencing.

Worth knowing first: [CORFU](/papers/corfu-shared-log-design-for-flash-clusters) and its soft-state sequencer, which the AtomicLog borrows; [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) and [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications), which also separate ordering from durability; [Raft](/papers/raft-understandable-consensus-algorithm) as the leader-driven alternative; and [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) for replicated state built on a log (this paper does not cite it). The paper also reuses the Loglet API and the VirtualLog from Delos (Balakrishnan et al., OSDI 2020), which is not in this library.

## Contribution

- **The LogDrive abstraction.** It exposes `write(address, payload)`, `read(address)` and `weakTail(K)`. Addresses are single-value registers, linearizable only as long as one value is ever written to them. `weakTail` returns the non-contiguous tail and the set of holes below it, and is not linearizable: it only has to equal a deterministic function of some unordered, non-atomic scan. The caller promises that no more than K addresses are in flight, which bounds the hole set.
- **Cheap backends.** The weak semantics let it sit over any key-value store, even without conditional puts. On S3 the authors reverse-encode addresses so that listing returns the last K writes, on DynamoDB they use a partition key per drive with the address as sort key, and on S3Express (which cannot list in lexicographic order) they build a directory-like hierarchy and scan back K entries.
- **Composition by striping and replication.** A StripedLogDrive maps addresses RAID-0 style and takes the highest tail across stripes. A QuorumLogDrive writes to N replicas and acknowledges after Qw, in one round trip, with Qr = N - Qw + 1 and repair of ambiguous slots during `weakTail`. The two can be stacked either way (RAID-10-like or RAID-01-like).
- **The AtomicLog.** A stateless client library plus a soft-state sequencer (`acquireSlot` and `completeSlot`) implements the Delos Loglet API. Appends block when the window of K is full and linearize in address order, so a single `weakTail` yields a linearizable `checkTail`. A seal bit on cloud storage gives `seal`, and a sequencer fast path serves `checkTail` until the log is sealed.
- **Conflux and K2.** A VirtualLog identical to Delos stitches Loglets together, with membership in a conditional register on DynamoDB, so Conflux can switch backends without downtime. K2 stores each topic as an ordered list of data references, a "log on a log" that reuses the same API at both layers.

## Methodology

The evaluation mixes benchmarks and production data on AWS, with Kubernetes, EBS disks and Datadog monitoring. In single-region tests there is one Conflux server per availability zone, and multi-region tests mirror synchronously to two other regions about 60 ms and 120 ms away. Benchmarks use m6g.xlarge instances, a 100 ms batching timeout, a 60KB batch threshold and K = 16, and snapshots go to S3 every 10 minutes. All latencies are p99. Records average 165 bytes in production and the write to read ratio is typically 1 to 3. The cost model prices 3 EC2 instances plus disks against a hypothetical DynamoDB strawman at 2K writes and 6K reads per second, using on-demand DynamoDB prices in us-west-2. Correctness rests on proof sketches (full proofs in an appendix) and on a simulation framework that injects failures and delays and checks linearizability.

## Findings

These are the authors' reported results.

- **Pluggability.** Conflux runs over S3, over DynamoDB with striping and over S3Express with quorums across three zones. The new code per backend is small: 519 lines for S3, 528 for DynamoDB, 525 for S3Express, 194 for striping and 325 for quorums. One engineer built a production-quality DynamoDBLogDrive in about a week.
- **Reconfiguration and durability.** A running service moved from a (3,3) DynamoDB quorum across three regions to (2,3), then to S3Express (3,3) and (2,3), without downtime. The S3Express (2,3) setup kept running through an emulated S3Express outage in us-west-2.
- **Cost.** In the modeled workload, metadata costs $0.69 per hour on Conflux over DynamoDB against $7.20 for the strawman (10×), and total cost is $3.06 against $9.57 (over 3×, with a data plane of $2.37 per hour). Conflux over S3 totals $3.47 and over S3Express $3.22.
- **Latency.** Conflux over DynamoDB has a p99 of roughly 130 ms, which the authors call a 6.5× write slowdown against the strawman, acceptable for their use case.
- **Production.** A K2 cluster in three zones of us-west-2 with 114 brokers (108 serving) and 20 Conflux shards of three servers each sustained 9GB/s produce and 27GB/s fetch. Produce p99 was about 600 ms, fetch p99 about 300 ms, and metadata compressed about 6 to 7×.
- **Live migration.** An early-access cluster switched from S3 to DynamoDB with no downtime, because S3 had worse cost and performance. Rate limits on DynamoDB partition keys were worked around with striping.
- **Testing.** Simulation exposed a pagination-induced linearizability violation in the S3 drive, which led the authors to conclude `weakTail` need not be linearizable, and independently found a seal-check ordering bug in the published Delos VirtualLog protocol.

## Critical Analysis

The separation is clean, and the argument for why replication composes only below the sequencer is convincing. The paper concedes several costs.

- **Small K and blocking appends.** `weakTail` is only practical for small K, and an append must wait while the window is full, so one stuck write stalls the writers behind it.
- **Appends are not highly available.** A sequencer failure, or a client crashing after it acquired a slot, makes the Loglet unavailable for appends until it is sealed and replaced through the VirtualLog.
- **The cost baseline is hypothetical.** The authors say a production DynamoDB shim would need non-trivial engineering, and treat their strawman as a lower bound on latency and cost. The 10× also comes with the 6.5× write slowdown, and S3 turned out worse than DynamoDB on both cost and performance.
- **Resharding is still conventional.** It uses a locking transaction protocol, and virtualizing a topic across shards is only being explored.

The following points are a reading of the evidence, not claims of the paper.

- **The cost win is mostly the log, not the LogDrive.** The saving comes from batching small writes and serving reads from a local copy, which any log-plus-materialized-view design gets. The LogDrive's own contribution is portability and composition, and the paper never prices a DynamoDB design with a cache, although Section 2 says that caching is what would keep read costs from blowing up.
- **One workload, one scale.** The cost table models 2K writes and 6K reads per second with 165-byte records and a 5× compression factor. The production cluster has 20 shards, but no production cost is reported.
- **Failure evidence is thin.** The outage test is one emulated event (access control disabled), and the paper gives no recovery time for a sequencer failure, shows reconfiguration only as latency timelines, and does not say how many simulated executions were run.
- **The low-latency configuration is unmeasured.** The paper builds a single-node LogServer on local SSD under quorums and striping, "to test this hypothesis", and then reports no numbers for it.
- **No head-to-head with other logs.** There is no measured comparison with Delos's native Loglet, [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) or a Raft-based store. Against [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications) the contrast is conceptual, and the paper itself says LazyLog changes when a timestamp is assigned while Conflux changes which layer assigns it.
- **Each backend carries its own argument.** The few hundred lines per drive hide a listing-semantics proof obligation, as the pagination bug shows.

## Further Research

- Resharding by virtualizing a topic's index across shards, which the paper is exploring, replacing the current locking transaction.
- Measuring the stacked low-latency design (LogServer with quorums and striping) against server-based shared logs and cloud-backed drives under the same workload.
- Running the log-based serverless and stream systems the paper cites, such as [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) and [FlexLog](/papers/flexlog-shared-log-for-stateful-serverless-computing), directly over LogDrives, as the authors suggest.
- Pricing a cached DynamoDB baseline and testing correctness and recovery under injected sequencer, partition and multi-backend failures, to separate the effect of the LogDrive from the effect of batching.

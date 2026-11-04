---
title: "Boki: Stateful Serverless Computing with Shared Logs"
summary: Boki is a FaaS runtime that gives serverless functions a shared log API, built around a metalog that handles ordering, read consistency and fault tolerance with one mechanism, plus libraries for workflows, object storage and message queues.
researchArea: Distributed Systems
keywords: shared log, serverless computing, function as a service, metalog, consistency, fault tolerance, state machine replication
version: 1.0
updatedAt: 2026-11-03
---

## Abstract

Boki is a new serverless runtime that exports a shared log API to serverless functions. Boki shared logs enable stateful serverless applications to manage their state with durability, consistency, and fault tolerance. Boki shared logs achieve high throughput and low latency. The key enabler is the metalog, a novel mechanism that allows Boki to address ordering, consistency and fault tolerance independently. The metalog orders shared log records with high throughput and it provides read consistency while allowing service providers to optimize the write and read path of the shared log in different ways. To demonstrate the value of shared logs for stateful serverless applications, we build Boki support libraries that implement fault-tolerant workflows, durable object storage, and message queues. Our evaluation shows that shared logs can speed up important serverless workloads by up to 4.7×.

## Overview

Serverless functions are stateless, but the applications built from them are not. In the paper's example, a travel reservation calls one function for hotels and another for flights, and either can fail midway, leaving inconsistent state behind. Zhipeng Jia and Emmett Witchel present Boki at SOSP 2021 as a FaaS runtime, built on their Nightcore system, where functions manage state through a shared log instead of a put/get store.

A shared log is a totally ordered log that many clients append to and read concurrently. [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) and [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log) showed that shared logs can back consistent, durable objects, and Boki takes its ordering protocol from [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order). The new problem is the serverless setting: function memory is not guaranteed to survive between invocations, storage is disaggregated from compute, and many logs must share hardware efficiently.

Worth knowing first: state machine replication, quorums, the read guarantees called monotonic reads and read-your-writes, and the split between replicating records and ordering them.

## Contribution

- **The LogBook API.** Each function invocation is bound to one LogBook, with append, read and trim calls. Tags select sub-streams, so a reader skips unrelated records.
- **The metalog.** Each physical log has one metalog recording its internal state transitions. Appending to it decides the total order, comparing positions in it enforces read consistency, and sealing it pauses the log for reconfiguration. The paper calls it "the Answer to Everything" in Boki.
- **A log index on function nodes.** Many LogBooks are multiplexed on one physical log and records can land in any shard. LogBook engines beside the functions keep a compact index and a record cache, which separates the read path from the write path.
- **Auxiliary data.** A best-effort, per-record cache that spares functions a full log replay.
- **Three support libraries.** BokiFlow adapts Beldi's fault-tolerant workflows, BokiStore adapts Tango's transactional objects with snapshot isolation, and BokiQueue adapts vCorfu's composable state machine replication.

## Methodology

On append, a LogBook engine numbers the record locally and replicates it to the storage nodes of its shard. Storage nodes periodically send progress vectors to the primary sequencer, which takes their element-wise minimum and appends it to the metalog, ordering records across shards. The metalog itself uses a primary-driven protocol: only the primary appends, and each entry waits for a quorum of sequencers. Each function tracks a metalog position, and a read is suspended if the local index is behind it.

Log records live in RocksDB on storage nodes. Experiments ran on EC2 c5d.2xlarge instances with NVMe SSDs in one region, with records and metalogs replicated three times by default.

The evaluation has microbenchmarks plus one comparison per library. BokiFlow runs Beldi's movie and travel workloads against Beldi ported to Nightcore. BokiStore runs a Retwis-inspired workload against MongoDB. BokiQueue runs against Amazon SQS and Apache Pulsar.

## Findings

These are the authors' reported results.

- **Appends.** One LogBook reached 1.2M Ops/s with 64 nodes and 2,560 concurrent functions, at 2.03 ms median and 6.42 ms p99 latency.
- **Reads.** A local cache hit takes 121 µs. The median is 0.57 ms on a local cache miss and 0.79 ms through a remote engine.
- **Virtualization.** Four physical logs carried 100K LogBooks at 446.9 KOp/s, against 458.2 KOp/s for 100 LogBooks. Under a skewed Zipf load (s = 5), the log index delivered 278.6 KOp/s and fixed sharding 129.6.
- **Reconfiguration.** Appends returned to normal latency within 100 ms, and the protocol itself took 15.7 ms with three sequencers.
- **BokiFlow.** Median latency was 26 ms against Beldi's 121 ms on movie reviews at 200 requests per second (4.7×), and 18 ms against 78 ms on travel at 500 (4.3×). Against a baseline without exactly-once semantics, it costs 3.0× and 1.8×.
- **BokiStore.** Throughput was 1.18 to 1.25× that of MongoDB and transactions up to 2.3× faster, but non-transactional reads were slower.
- **BokiQueue.** Throughput was 1.66 to 2.14× that of SQS, with up to 15× lower latency, and 1.06 to 1.23× that of Pulsar, with up to 2.0× lower latency.

## Critical Analysis

Using one mechanism for ordering, consistency and reconfiguration is a clean result. Several limits are stated in the paper itself.

- **Log replay is expensive.** The authors blame log replay for slower non-transactional reads: UserLogin took 1.47 ms at the median against 0.86 ms for MongoDB. Without auxiliary data, Retwis fell to 939 Op/s at three minutes, against 11,078 with it, and the table has no result for longer runs.
- **Locality is not automatic.** The BokiStore comparison used the best case, with an index on all 8 function nodes, yet the paper says that "In a large-scale deployment, having all LogBook engines maintain an index for a particular physical log is not viable." At 25% local reads, Retwis kept 77% of its maximum throughput.
- **Auxiliary data needed a second design.** At a 16 MB cache, throughput dropped to 3,561 Op/s. Backing auxiliary data up on storage nodes restored it to 11,358, which departs from the simpler function-node-only store described in the design section.

Other limits come from reading the evaluation.

- **The headline number has a specific opponent.** The 4.7× compares median latency at one load point against a logging layer built on DynamoDB. Against MongoDB and Pulsar the best latency gains are 2.3× and 2.0×, with throughput gains up to 1.25× and 1.23×, and in the saturated 4:1 queue case Pulsar has the better p99 in all three configurations, such as 12.7 ms against 27.3 ms.
- **Reconfiguration was tested on command.** The experiment moves to pre-provisioned sequencers. Crashes of storage nodes or LogBook engines, and the time to detect them, are not measured.
- **Metalog durability is conditional.** In the prototype, metalogs "are replicated in the DRAM of sequencer nodes", which the paper accepts under the assumption that a quorum of sequencers stays alive. A correlated loss of that quorum is outside the evaluation.
- **Elasticity and cost are claimed more than tested.** Deployments are measured at fixed sizes, and neither the price of dedicated storage and sequencer nodes nor interference between LogBooks on a shared physical log is measured.

[FlexLog](/papers/flexlog-shared-log-for-stateful-serverless-computing) later claims better storage throughput and ordering latency than Boki. That is FlexLog's own result, under its own layer-by-layer setup.

## Further Research

- How should a FaaS scheduler place functions when engines cannot index every physical log?
- What does a durable metalog cost compared with DRAM replication, and which failures would it cover?
- Can checkpoints combine with auxiliary data to bound replay for read-heavy objects?
- How does Boki behave under crashes of storage nodes and correlated sequencer failures?
- How much do tenants sharing a physical log interfere with each other, and what does that cost compared with cloud databases?

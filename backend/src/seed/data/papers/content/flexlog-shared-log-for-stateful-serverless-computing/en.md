---
title: "FlexLog: A Shared Log for Stateful Serverless Computing"
summary: FlexLog is a distributed shared log for serverless functions that stores records on persistent memory and orders them with a tree of sequencers, letting applications choose ordering per log region instead of accepting one global total order.
researchArea: Distributed Systems
keywords: shared log, serverless computing, persistent memory, sequencer, flexible ordering, multi-tenancy
version: 1.0
updatedAt: 2026-11-03
---

## Overview

Published at HPDC 2023 by Dimitra Giantsidi, Emmanouil Giortamis, Nathaniel Tornow, Florin Dinu and Pramod Bhatotia, FlexLog starts where [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs) did, treating a shared log as the state layer for serverless functions. The authors then name two limits of existing shared logs: they are built on SSDs, and most are designed for total ordering, which is stricter than many serverless applications need. A chained data analytics job, for example, must serialize its phases but not the parallel tasks inside a phase.

A local profile of two workloads, video processing and gzip compression, shows 41% and 48.1% of CPU time spent on storage calls. FlexLog answers with records stored in Intel Optane persistent memory (PM) and a log split into regions, each with its own total order.

Worth knowing first: the split between a data layer and an ordering layer in a shared log, linearizability, and how Paxos reaches agreement.

## Contribution

- **Colors.** A color is a region of the log made of shards, and each region has a sequencer in an n-ary tree. Records of different colors are ordered arbitrarily. Appending to a single color gives linearizability, writing across colors gives eventual consistency, and unrelated applications can use distinct colors for multi-tenancy.
- **Sequencing without per-request consensus.** A sequence number combines a 32-bit epoch and a 32-bit counter. The 2f backups replicate only the epoch and stay out of normal execution. Sequencers below the root merge concurrent requests of the same color.
- **Tiered storage.** Each replica has a DRAM cache, a crash-consistent log in PM and SSD for old log segments.
- **Function-driven replication.** A function broadcasts a record to all replicas of a random shard. Each replica persists it and asks for a sequence number, then commits when the leaf sequencer answers. The append ends when every replica acknowledges, which allows linearizable reads from one replica.
- **Multi-color append.** A protocol specified in the paper uses a special color as a broker to append to several regions all-or-nothing.

## Methodology

The paper gives the protocols, a proof sketch of linearizability, and an implementation in Go (ordering and replication) and C++ on PMDK (storage). The cluster has 6 machines with 800 GB of Optane PM and a 10 Gbps network, with processes collocated. Defaults are 3 replicas per shard, 1 KB records and a 1 µs batching interval.

The paper calls its Boki comparison "apples-to-apples", and it runs layer by layer. For ordering, no data is written. Because "we were not able to run a multi-client deployment of Boki's ordering layer", latency is compared with a single client, and multi-user throughput is compared against libpaxos with one proposer, standing in for the ordering abstraction of Boki and Scalog. For storage, the PM layer faces RocksDB with a 64 MB MemTable and write-ahead logging enabled, using db_bench.

## Findings

These are FlexLog's own claims, under the conditions above.

- **Storage against Boki.** Throughput is an order of magnitude higher across record sizes and thread counts. The authors attribute Boki's limit mainly to sync syscalls.
- **Ordering against Boki.** Latency stays below 250 µs, 2.5× to 4× better in the results section (the abstract says 2× to 4×).
- **Ordering against Paxos.** Throughput is 2× to 3× higher than libpaxos.
- **Flexible ordering.** Skipping the root sequencer (FlexLog-P) adds 10% throughput over total ordering.
- **Where the time goes.** With a function collocated with storage, storage latency is 1 µs and ordering latency 250 µs and 100 µs in two workloads. The authors conclude: "The performance gains come from the fast ordering protocol (in appends) rather than the use of PM."
- **Replication.** Append latency is stable up to 3 replicas and doubles at 4, 6 and 8.
- **Scale.** One leaf sequencer issues about 1.2M sequence numbers per second, and each added leaf about 1M more. An order request takes about 110 µs with one sequencer, growing linearly with tree height. Six shards deliver double the throughput of three under 95% reads.

## Critical Analysis

The paper states several limits itself. Optane has been discontinued, and CXL is offered as a future path. The proof omits "most of the details". Replica failures block appends, and a permanently lost replica leaves its shard readable but not writable. Implementation is partial: "we implemented only the single-log Append and Read operations", which conflicts with the introduction's claim of implementing all protocols and auxiliary operations.

Other limits come from reading the evaluation.

- **The Boki comparison is not end to end.** No experiment runs a replicated, ordered append through both systems, and the evaluation runs no serverless application on FlexLog.
- **The 3× is not measured against Boki.** The takeaway box states up to 3× ordering throughput relative to Boki, but the experiment behind it uses libpaxos, and Boki is not in that plot.
- **The baseline differs from Boki's own description.** FlexLog configures Boki's sequencers to "run Paxos" and discusses multi-proposer livelock. The Boki paper describes a primary-driven metalog where only the primary appends, waiting for a quorum. Boki also orders records periodically, so a single-client latency depends on a period FlexLog does not report.
- **The read motivation is selective.** FlexLog says Boki reports 1 to 3 ms reads. Boki's own Table 3 gives medians of 0.12 to 0.79 ms and p99s of 0.72 to 2.90 ms, so that range fits only the slower tails. FlexLog does not compare read latency with Boki directly.
- **The storage gap varies.** The test drives RocksDB with db_bench rather than Boki's nodes with their caches, and the setup does not describe the SSD. Figure 7 shows the gap closing to well under 10× at 99% reads.
- **PM is not the main append result.** By the authors' own takeaway, ordering drives appends, so the 10× storage result does not carry over to them.
- **Flexibility is barely measured.** Its evidence is one 10% figure. Multi-color appends and multi-tenancy have no experiment, and Algorithm 2 appends color by color, so the all-or-nothing proof does not show that a reader cannot observe a partial result.
- **Scale evidence is narrow.** Reported shard scaling is one doubling on 6 machines under 95% reads. Boki's 1.2M Ops/s and FlexLog's 1.2M sequence numbers per second are different quantities.
- **Failure coverage is thin.** Replica recovery, which grows almost linearly with the records to recover, uses a microbenchmark on one replica, and sequencer failover is not measured.

## Further Research

- How do FlexLog and Boki compare end to end, with one application, the same hardware and a multi-client Boki ordering layer?
- Does the design keep its latency on CXL-attached memory, which the paper proposes but does not test?
- How much does relaxed ordering save in taller trees, and which real applications can use it?
- What isolation can a multi-color append give to concurrent readers?
- Does contacting one replica of every shard on each read limit scaling beyond 6 shards, and would an index help?

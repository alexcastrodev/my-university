---
title: "LazyLog: A New Shared Log Abstraction for Low-Latency Applications"
summary: LazyLog keeps the linearizable total order of a shared log but binds records to positions only after the append returns, so ingestion takes one round trip and ordering happens in the background before reads arrive.
researchArea: Distributed Systems
keywords: shared log, lazy ordering, linearizability, total order, low latency, sequencing layer
version: 1.0
updatedAt: 2026-11-03
---

## Abstract

Shared logs offer linearizable total order across storage shards. However, they enforce this order eagerly upon ingestion, leading to high latencies. We observe that in many modern shared-log applications, while linearizable ordering is necessary, it is not required eagerly when ingesting data but only later when data is consumed. Further, readers are naturally decoupled in time from writers in these applications. Based on this insight, we propose LazyLog, a novel shared log abstraction. LazyLog lazily binds records (across shards) to linearizable global positions and enforces this before a log position can be read. Such lazy ordering enables low ingestion latencies. Given the time decoupling, LazyLog can establish the order well before reads arrive, minimizing overhead upon reads. We build two LazyLog systems that provide linearizable total order across shards. Our experiments show that LazyLog systems deliver significantly lower latencies than conventional, eager-ordering shared logs.

## Overview

A shared log is a fault-tolerant, ordered sequence of records that many clients append to and read from. Logs such as [Corfu](/papers/corfu-shared-log-design-for-flash-clusters) and [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order) spread records over many storage shards and still promise one linearizable order across all of them. To do so they settle a record's position before the append returns, which puts coordination on the write path: Scalog reports mean append latencies of 1 to 2 ms even at low throughput.

This SOSP 2024 paper, from the University of Illinois Urbana-Champaign and VMware Research, observes that many applications need the order when data is consumed, not when it is ingested, and that their readers run behind their writers. A log can then acknowledge a write once it is durable and decide its position afterwards.

Worth knowing first: linearizability (if append B starts after append A completes, B is ordered after A), and the difference between order inside one shard, as in Kafka, and total order across shards.

## Contribution

- **A new abstraction.** `append` makes a record durable and guarantees it will later be bound to its correct linearizable position, returning a success flag instead of a position. `read`, `checkTail` and `trim` are unchanged. The paper argues this fits databases with decoupled readers, event sourcing, message queues, journals, activity logging and log aggregation.
- **Order recovered from uncoordinated replicas.** Clients write in parallel to all replicas of a sequencing layer. If b starts after a completes, a is already on every replica, so b lands after a everywhere, and only concurrent appends can differ. Any replica's log therefore gives a valid order, and the leader's is used in normal operation.
- **The stable-gp invariant.** Shards serve reads only up to a counter that advances after every sequencing replica has garbage collected the batch, so an order a reader has seen cannot change in recovery.
- **Two systems.** Erwin-■ (black box, also called plain Erwin in the paper) sends records through the sequencing layer, which pushes them to unmodified shards in the background. Erwin-st (scalable throughput) sends only metadata through that layer and writes data directly to a shard the client picks, which requires modified shards. Both complete appends in one round trip (1 RTT).

## Methodology

Both systems share about 8K lines of C++. Experiments ran on CloudLab with a three-replica sequencing layer and at most five shards, plus a second cluster with up to 10 shards for scaling. The baselines were a Corfu the authors implemented from scratch and the public Scalog artifact, compared on append-only 4KB records at equal throughput. Other runs varied read lag, append rate and record size, put Erwin-■ over Kafka shards, and crashed a sequencing replica. Three applications were built: a KV store modeled on FireScroll, audit logging for transactions, and a journaled stream job.

## Findings

These are the authors' reported results. The comparisons with Corfu and Scalog use Erwin-■.

- **Appends.** Up to 3.8× lower latency than Corfu at the same throughput (the introduction rounds this to about 4×), since Corfu needs 4 RTTs with three replicas and Erwin-■ one. Against Scalog, mean and p99 fall by two orders of magnitude.
- **Reads.** With reads lagging by 3 ms, latency stays close to Corfu's. With no lag, reads pay for ordering: large batches keep them only slightly slower than Corfu at 45K operations/s, while at 5K almost all reads take the slow path.
- **Throughput.** Erwin-■ reaches about 1M appends/s with 100-byte records but flattens with larger ones. Erwin-st reaches about 700K appends/s with 4KB records on 10 shards, at 29 µs.
- **Kafka.** Against stand-alone Kafka, Erwin-■ over one Kafka shard cuts latency by three orders of magnitude, and three shards give similar benefits plus linearizable total order.
- **Failures.** A sequencing replica crash disturbs the workload for about 15 ms, and core recovery takes 600 µs.
- **Applications.** The KV store gains 3.4× when write-only, about 2.5× when write-heavy, and little when read-heavy. Audit logging gains 1.8× for write transactions and 2.9× for read transactions, and journaling 1.17× to 1.66× as batches shrink.

## Critical Analysis

The core argument is clean, and the Corfu ratio lines up with the round-trip count. The paper itself concedes three limits.

- **Writing to all replicas.** Any sequencing replica failure forces a reconfiguration, and stragglers raise tail latency. The supermajority alternative is future work, and the roughly 1 ms reconfiguration is a projection with a faster ZooKeeper replacement.
- **Scalability.** Erwin-st scales like Corfu and cannot reach Scalog's level, which the authors call an open challenge.
- **Implementation differences.** Scalog's artifact uses gRPC and Erwin eRPC. The authors accept that a better Scalog would be faster and argue the gap would remain, without measuring it.

The following points are a reading of the evidence, not claims of the paper.

- **Time decoupling is argued, not measured.** The case rests on descriptions of applications, not on read-lag data from deployments. Later work with overlapping authors, [SpecLog](/papers/speclog-low-latency-speculative-shared-log-fix-ante-ordering), says the assumption fails for applications that consume records as soon as they arrive, and that LazyLog's end-to-end latency "will always include the cost of ordering".
- **The worst case is promised more than shown.** The paper says that without batching LazyLog matches a conventional log's overall performance, yet at 5K read latency exceeds Corfu's 70 µs append cost. The authors blame tuning for large batches but measure no fix.
- **Part of the gain is where durability is declared.** Erwin-■ acknowledges once records sit in memory on the sequencing replicas, which the paper calls standard practice. Simultaneous power loss on those replicas is still a different risk from a write to a disk-backed shard, and the paper does not address it.
- **The evaluation favors the append side.** The audit workload does not read the log, KV store reads come from local state, and the journal is not replayed. The Kafka run is append-only, so it does not exercise the tail overwrite that view changes require of shards, and Erwin-st has no direct latency comparison with Corfu or Scalog.

## Further Research

- Supermajority writes, which the paper names as future work: what recovery complexity do they add, and how much do they tame stragglers?
- Measurements of real read lag in deployments, which would show how often the fast path applies.
- Client failures in Erwin-st: a shard primary waits for a timeout on metadata without data, and stable-gp needs every shard to finish.
- Whether lazy ingestion and the speculative delivery of SpecLog can work in one system.

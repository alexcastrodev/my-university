---
title: "Scalog: Seamless Reconfiguration and Total Order in a Scalable Shared Log"
summary: Scalog is a totally ordered shared log that replicates records first and orders them afterwards, by periodically interleaving the FIFO logs of its storage servers, so that shards can be added or finalized without global coordination.
researchArea: Distributed Systems
keywords: shared log, total order, reconfiguration, sharding, persistence-first, paxos, replication
version: 1.0
updatedAt: 2026-11-03
---

## Overview

A shared log is an ordered sequence of records that many clients can append to and read. This NSDI 2020 paper, from Cornell University and Alibaba Group, starts from a gap: [Corfu](/papers/corfu-shared-log-design-for-flash-clusters) gives total order but becomes unavailable whenever its set of storage servers changes, and Kafka scales by sharding but orders records only within a shard. In the authors' words, "no shared log provides both total order and seamless reconfiguration".

Their diagnosis is the order of two steps. In Corfu and LogDevice a record first receives a position and is then replicated, so a client that fails after reserving a slot can leave a hole, and in Corfu all clients and servers must hold the same mapping from positions to shards. Scalog reverses the steps: records are replicated first and receive a position afterwards.

Worth knowing first: the shared log abstraction, primary-backup replication, Paxos, and the difference between crash failures, which cannot be detected accurately, and fail-stop, which assumes that they can.

## Contribution

- **Persistence before order.** A client sends a record to a storage server of its choice without knowing its position. The server forwards it over FIFO channels to the other servers of the shard.
- **Order by interleaving cuts.** Each server periodically reports a local cut, a vector counting the records it holds per segment. The ordering layer takes the minimum across a shard's servers to find what is durable and sends a global cut to all servers. A deterministic function then orders the records between consecutive cuts.
- **An ordering layer that handles no records.** It runs Paxos above a tree of soft-state aggregators, and its load depends on the number of servers and how often they report, not on write throughput.
- **Reconfiguration without global coordination.** A new shard joins by registering with the ordering layer. A shard is finalized on a schedule, with a grace period of committed cuts, or at once after a failure.
- **Three failure policies.** Finalize & Add and Remove & Replace need f + 1 servers per shard and Mask needs 2f + 1, trading resources, data locality and recovery time.
- **Application-controlled placement.** A sharding policy lets vScalog use a shard as the materialized stream of [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log), with no separate stream replicas.

## Methodology

The Go prototype ran on 40 CloudLab servers with SSDs and a 10 Gbps network, using 4 KB records and, by default, f = 1: three Paxos replicas and two servers per shard. The baseline is the authors' own Go implementation of Corfu, which they report as faster than the open-source one.

Reconfiguration and failure tests use six shards at 50K writes per second, roughly half of the maximum. For write scaling, the interleaving interval is fixed at 0.1 ms to match Corfu's write latency. Beyond 40 machines the authors emulate: first storage servers, which report as if receiving records, and then aggregator layers as well, with Paxos and the top aggregator layer on physical servers.

## Findings

These are the authors' reported results. Each throughput number comes from a different setup.

- **Reconfiguration.** Adding or finalizing a shard leaves Scalog's throughput unaffected, while Corfu's stops for roughly 30 ms.
- **Failures.** After a Paxos leader or aggregator failure, records cannot commit for a while but servers keep receiving them, so throughput dips and then spikes, with total throughput unaffected and latency worse. With Finalize & Add, throughput returns after slightly more than a second, given a one-second timeout.
- **One shard.** Scalog peaks at 18.7K writes per second and the Corfu baseline at 13.9K, a gap the authors attribute to sequential versus random disk writes.
- **Scale, measured.** 17 shards at 15K writes per second each give 255K totally ordered writes per second.
- **Scale, emulated.** With emulated storage servers and real aggregators, Scalog reaches 2.34M writes per second, still unsaturated. With emulated aggregators too, the ordering layer handles up to 3,500 shards before Paxos becomes the bottleneck, which translates to 52M. The authors estimate that latency at around 1.6 ms. Corfu is limited by its sequencer at 530K.
- **Reads.** A single storage server serves 280K records per second from memory. From disk, sequential `subscribe` reaches 57K and random `readRecord` 4.5K.

## Critical Analysis

The design argument is clean, and the reconfiguration experiment shows it directly. The scale numbers need more care.

The paper states several limits itself. Scalog has no automated policy for adding or finalizing shards, is not well suited to ultra-low, highly predictable or low-tail latency, and does not address security. vScalog must log every transaction, including those that abort. Footnote 4 says that emulation measures only how many shards the ordering layer can handle, and that other issues, such as the network, were not assessed.

The rest is a reading of the evidence, not a statement by the authors.

- **52M measures the ordering layer, not a working log.** It equals roughly 3,500 shards times the configured 15K per shard, those shards store no real records, and its latency is an estimate. The largest result in the text with real storage servers is 255K, below Corfu's 530K sequencer limit, so "almost two orders of magnitude" compares capacity limits, not deployed logs.
- **Consuming the order is not examined.** A client reading from many servers is limited by its network to an average of 280K records per second here. A subscriber that wants the whole log could not follow 2.34M records per second over that link, let alone 52M.
- **"Seamless" is narrower under failure.** The clean result covers planned changes at half load. After a storage failure, the cost depends on the policy. Under Finalize & Add, clients must redirect and retransmit records missing from the last cut, and one intolerably slow server finalizes a whole shard. Remove & Replace temporarily stops writes to the shard. Mask keeps the shard serving reads and writes, but needs 2f + 1 servers. The cost of false suspicions is not measured.
- **Some claims have thin support.** vScalog's twice-as-high read throughput appears in the introduction, but its evaluation reports only writes. Corfu's reads are called identical by reasoning about paths, not by measurement. The baseline is a reimplementation on SSDs, and the text reports no latency percentiles.

## Further Research

- Whether latency can be drastically reduced while keeping Scalog's throughput and ordering, a question the paper itself leaves open.
- Automated policies for adding and finalizing shards that also limit finalizations caused by false suspicions.
- An end-to-end test at thousands of real shards, with the network and the distribution of cuts included.
- How subscribers can consume a total order larger than the bandwidth of any one client, and which applications need all of it.
- A machine-checked specification of cut-based ordering together with reconfiguration, which the paper does not provide.

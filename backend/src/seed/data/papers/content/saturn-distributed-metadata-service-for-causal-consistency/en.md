---
title: "Saturn: a Distributed Metadata Service for Causal Consistency"
summary: Saturn is a metadata service that propagates small constant-size labels through a tree of serializers, so that geo-replicated stores gain causal consistency at little throughput cost, with low remote visibility latency and genuine partial replication.
researchArea: Distributed Systems
keywords: causal consistency, geo-replication, partial replication, metadata service, false dependencies, visibility latency
version: 1.0
updatedAt: 2026-11-03
---

## Overview

Causal consistency matters for geo-replicated stores because, as the paper recalls, it "has been proved to be the strongest consistency model that does not compromise availability". The difficulty is metadata. Compressing it creates false dependencies, where one update waits for another that is concurrent with it, so remote data becomes visible late. Tracking causality precisely avoids this, but the overhead lowers throughput. GentleRain, with a single scalar, and Cure, with a vector clock holding one entry per datacenter, illustrate the two sides. Partial replication adds delays caused by items a site does not even store.

This EuroSys 2017 paper takes metadata out of the data path. Saturn is a separate service attached to an existing store. It handles only small labels, while data travels through the application's bulk transfer, and a datacenter applies a remote update once it holds both payload and label.

Worth knowing first: causal order, Lamport-style timestamps, eventual consistency, and partial replication, where each item lives in only some datacenters.

## Contribution

- **Constant-size labels.** A label holds a type, a source, a scalar timestamp and a target. Timestamp order respects causality, and clients keep only the greatest label they have observed.
- **A serialization per datacenter.** Causal order is partial, so several serial orders are valid. Delivering the label of a slow update too early makes later, unrelated updates wait, so Saturn aims to deliver each label about when its data arrives.
- **A tree of serializers.** Serializers forward labels in arrival order over FIFO channels, with datacenters as leaves, which preserves causality. Labels skip branches with no interested datacenter, giving genuine partial replication.
- **A configuration problem.** Saturn places serializers and adds artificial delays so that metadata paths match bulk-data latencies, weighted by each path's importance. The problem is NP-hard, so a heuristic prunes candidate trees with a constraint solver.
- **A fallback.** Labels also travel with payloads, so datacenters can use timestamp order during an outage.

## Methodology

The prototype, in Erlang/OTP, is attached to an eventually consistent store the authors built. That store is the baseline, and "optimal" visibility means its latency. Experiments run on EC2 m4.large instances in seven regions, with one datacenter per region. GentleRain and Cure run their stabilization every 5 ms. COPS and Eiger are left out because the authors conclude that explicit dependency checking is impractical under partial geo-replication.

Synthetic sweeps vary one parameter at a time around 2-byte values, a 9:1 read/write ratio and no remote reads. The Facebook-based benchmark combines a public New Orleans dataset (61,096 nodes, 905,565 edges), an operation mix from a published study and locality-driven partitioning.

## Findings

These are the authors' reported results. Each experiment has its own numbers.

- **Synthetic throughput, on average.** 2.2% overhead against eventual consistency, 4.8% above GentleRain and 24.7% above Cure. At 40% remote reads, 15.7% and 60.5% above them.
- **Synthetic visibility.** Latency added over optimal averages 7.3 ms for Saturn, 21.3 ms for Cure and 97.9 ms for GentleRain. On Saturn's worst path, Ireland to Sydney, it adds 20.4 ms at the 90th percentile, and Cure is 3.6 ms lower.
- **Facebook benchmark.** 1.8% overhead, with 10.9% more operations per second than GentleRain and 41.9% more than Cure. Added visibility averages 16.1 ms, against 79.2 ms and 23.7 ms. On the worst path, Ireland to Tokyo, Saturn adds 47.2 ms at the 90th percentile, 0.9 ms above GentleRain and 9.9 ms above Cure.
- **Configuration.** A multi-serializer tree deviates 8.2 ms from optimal on average, while timestamp order alone tends toward the longest travel time, 161 ms. With 25 ms injected on a 10 ms link, the normally optimal configuration adds 14 ms on average.

## Critical Analysis

The central idea holds up: order can be carried by the path of the metadata rather than by its size. Some claims around it go further than the evidence.

The paper itself concedes these limits:

- **A single tree cannot fit every pair.** Matching the optimal latency for every pair is "unlikely (impossible in most cases)". On the worst paths Cure and GentleRain can do better, so the abstract's "eliminates the tradeoff" is stronger than the results, which show a much smaller tradeoff, moved into the configuration.
- **Configuration is offline.** Substantial workload changes call for a new tree.
- **Correctness is sketched.** The tree argument is a footnote that omits the proof "due to lack of space".
- **The datacenter carries assumptions.** Each must be linearizable and export a single serial stream of updates.

The rest is a reading of the evaluation:

- **The headline numbers appear to be blends.** The introduction's 2%, 11.7 ms and 76.9 ms match the means of the synthetic and Facebook results, though the paper does not say so. Its 38.3% over Cure does not: 24.7 and 41.9 average 33.3.
- **Small values favor the design.** The default is 2 bytes, and the paper reports that at 2048 bytes all systems handle almost the same load.
- **The partial replication comparison is uneven.** The paper's Table 2 marks GentleRain and Cure as lacking partial replication, and Saturn alone has migration labels.
- **Failure paths are not measured.** No experiment times a serializer failure or the timestamp fallback, and the configuration results suggest that fallback gives up most of the freshness gain.
- **Scale is argued, not measured.** The evaluation stops at seven datacenters and does not report servers per datacenter.

## Further Research

- Evaluating serializer failures, the timestamp fallback and recovery under load.
- How timestamp-based stabilization progresses under partial replication when two datacenters share no data.
- Trees that adapt online to measured bulk-data latency, and what payloads that lag their labels cost.
- The cost of exporting one serial stream from large datacenters.
- The paper itself points to combining Saturn with Occult, and to a distributed version of Kronos.

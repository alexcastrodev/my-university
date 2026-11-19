---
title: "Scaling Memcache at Facebook"
summary: How Facebook turned open-source memcached into a distributed key-value cache serving over a billion requests per second, with lessons organized by scale (cluster, region, multiple regions) and a deliberately eventual consistency model.
researchArea: Distributed Systems
keywords: memcached, caching, leases, invalidation, eventual consistency, replication, key-value store
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Memcached is a well known, simple, in-memory caching solution. This paper describes how Facebook leverages memcached as a building block to construct and scale a distributed key-value store that supports the world's largest social network. Our system handles billions of requests per second and holds trillions of items to deliver a rich experience for over a billion users around the world.

## Overview

The paper is an industry experience report from NSDI 2013 about the memcached-based caching layer behind Facebook. Its workload is read-heavy (users consume an order of magnitude more than they create) and draws data from MySQL, HDFS and other backend services, so the team used memcached, a single-machine in-memory hash table with only set, get and delete, as a demand-filled look-aside cache. A web server reads the cache first, falls back to the database on a miss and sets the value; on a write it updates the database and then deletes the key. Deletes are chosen over updates because they are idempotent.

It is a useful companion to other key-value systems in the catalog. [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) is a persistent store that the Facebook authors describe as optimized for write-heavy workloads, while they say theirs targets a read-dominated workload and does not guarantee persistence. The paper also cites [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) as part of the line of distributed key-value work, and [Bigtable](/papers/bigtable-distributed-storage-system-structured-data) is an example of the persistent, structured storage that a cache like this can sit in front of (the paper itself names MySQL as the backing store). The authors organize the paper around three scales: a cluster (latency and load), a region of several frontend clusters (replication) and several regions (consistency).

Worth knowing first: consistent hashing, cache invalidation, MySQL replication, and the difference between a cache (safe to evict) and a store of record.

## Contribution

- **An architecture that evolves by scale.** One cluster, then several frontend clusters sharing a storage cluster in a region, then a master region plus read-only replica regions.
- **A stateless client and a proxy.** Routing, batching, serialization, compression and error handling live in a client library or in the standalone proxy mcrouter, so memcached servers never talk to each other.
- **Leases.** A 64-bit token bound to a key, handed to a client on a miss, addresses stale sets and thundering herds. A short-lived stale-value option complements it.
- **Pools, replication within pools and Gutter.** Workloads are partitioned into pools, hot small sets are replicated, and a small spare pool absorbs the traffic of failed servers.
- **An invalidation pipeline.** The daemon mcsqueal reads the committed SQL log and broadcasts deletes, and a remote marker handles reads after writes from a non-master region.
- **Single-server improvements and workload data.** An adaptive slab allocator, a transient item cache, fine-grained locking, shared-memory upgrades and measurements from production.

## Methodology

This is a systems description backed by production measurements, not a controlled experiment. The authors present each mechanism together with the problem that motivated it, and support it with data collected from the live site: sampled memcache operations at web servers, per-pool statistics averaged over time windows, a one-in-a-million key sample to approximate working sets, and a monitor that samples one in a million deletes and later checks every frontend cluster for the key. Single-server results use a test rig with fifteen clients and one 24-thread memcached server on gigabit ethernet, measured over two minutes of sustained load. The paper states that the design priorities were that any change must address a user-facing or operational issue, and that the probability of reading transient stale data is a parameter to tune, like responsiveness.

## Findings

All numbers below are the paper's own.

- **Fan-out is large.** A popular page fetches an average of 521 distinct items, batches average 24 keys, 56% of page requests contact fewer than 20 memcached servers and most requests for one popular data-intensive page access over 100 distinct servers.
- **UDP for gets, TCP for sets and deletes.** Gets go straight over UDP from web server threads, deletes and sets go over TCP through a local mcrouter that coalesces connections. At peak, 0.25% of gets are dropped (about 80% late or lost packets, the rest out of order) and treated as misses. UDP gives about a 20% latency reduction. A sliding window limits incast congestion.
- **Latency.** Over 7 days the median round trip is 333 microseconds, p75 475 microseconds, p95 1.135 ms. From an idle web server the median is 178 microseconds.
- **Leases.** With one token per key every 10 seconds by default, the peak database query rate for a set of herd-prone keys fell from 17K/s to 1.3K/s.
- **Gutter.** About 1% of a cluster's servers. It reduces client-visible failures by 99% and converts 10% to 25% of failures into hits each day. After a server failure, gutter hit rates generally exceed 35% in under 4 minutes.
- **Regional invalidation.** Only 4% of deletes issued invalidate cached data. Batching through mcrouter improves the median deletes per packet 18 times. Cross-cluster bandwidth is 40% lower than within a cluster. Cold Cluster Warmup brings a new cluster to full capacity in hours instead of days, using a two second hold-off on deletes to avoid inconsistency.
- **Remote marker.** A write from a non-master region sets marker rk, writes to the master with k and rk in the SQL statement, and deletes k locally. A later miss checks rk and reads from the master region if it is present, trading latency for less stale data.
- **Delete reliability.** Within the master region, four nines within 1 second and five nines after an hour; for deletes originating outside the master region, three nines within a second and four nines within 10 minutes.
- **Single server.** Fine-grained locking raises the peak get rate for hits from 600k to 1.8M items per second and for misses from 2.7M to 4.5M. UDP beats TCP by 13% for single gets and 8% for 10-key multigets. Giving a short expiration to one key family reduced its share of a pool from 6% to 0.3%.
- **Pool miss rates** (peak averages): wildcard 1.76%, app 7.85%, replicated 0.053%, regional 6.35%.

The authors list five lessons: separating cache from persistent storage lets each scale on its own, monitoring and debugging features matter as much as performance, stateful components are harder to run than stateless ones, features need gradual rollout and rollback, and simplicity is vital.

## Critical Analysis

The paper is candid that consistency is the soft spot: it provides "best-effort eventual consistency" and treats stale reads as a tunable cost. It does not claim linearizability, causal consistency, or any bound on staleness. The remote marker can itself mislead under concurrent modifications to the same key, and the cold-warmup hold-off is acknowledged to be a probabilistic guard, not a proof.

What the paper does not give: the number of servers or clusters (only "hundreds" of memcached servers per cluster and "thousands of servers within a cluster" as the scaling challenge), an overall hit rate (only per-pool miss rates), or a controlled comparison against alternatives; the choice of memcached is justified as the best option under limited engineering time. The abstract says billions of requests per second while the introduction says over a billion, so the exact peak is not pinned down. Several decisions, such as moving a key family to a regional pool, are described as manual heuristics.

Later literature, not part of this paper and only partly read for this note: Facebook's TAO (the Memcache paper says TAO implements a graph data model and takes responsibility for persistence, and cites the SIGMOD 2012 poster; the later full paper at USENIX ATC 13 was confirmed only by its listing, not read); and CacheLib (Berg et al., OSDI 2020), a general-purpose caching engine that the OSDI abstract says was first deployed at Facebook in 2017. Only the abstract of CacheLib was read, so claims about how it relates to memcache are left out.

## Further Research

- Cache designs that offer stronger, provable consistency without losing the latency and load benefits reported here.
- Replacing manual pool and regionalization heuristics with automated, workload-driven decisions.
- Measuring how often stale reads actually occur in production, since the paper reports invalidation reliability but not user-visible staleness.
- Comparing look-aside caching with caches integrated into the storage layer, as in graph or structured stores.

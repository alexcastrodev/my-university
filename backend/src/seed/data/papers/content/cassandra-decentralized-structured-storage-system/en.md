---
title: "Cassandra - A Decentralized Structured Storage System"
summary: Lakshman and Malik describe Cassandra, built at Facebook for Inbox Search: a column-family store that puts Dynamo's partitioning, replication and gossip membership under a Bigtable-style data model and a log-structured local storage engine.
researchArea: Distributed Systems
keywords: cassandra, column family, consistent hashing, gossip, accrual failure detector, commit log, compaction, bloom filter
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Cassandra is a distributed storage system for managing very large amounts of structured data spread out across many commodity servers, while providing highly available service with no single point of failure. Cassandra aims to run on top of an infrastructure of hundreds of nodes (possibly spread across different data centers). At this scale, small and large components fail continuously. The way Cassandra manages the persistent state in the face of these failures drives the reliability and scalability of the software systems relying on this service. While in many ways Cassandra resembles a database and shares many design and implementation strategies therewith, Cassandra does not support a full relational data model; instead, it provides clients with a simple data model that supports dynamic control over data layout and format. Cassandra system was designed to run on cheap commodity hardware and handle high write throughput while not sacrificing read efficiency.

## Overview

This is the version presented at LADIS 2009 (the 3rd ACM SIGOPS workshop on Large Scale Distributed Systems and Middleware, October 10-11, 2009, co-located with SOSP), the open copy that was read. A shorter-titled version, "Cassandra", appeared in ACM SIGOPS Operating Systems Review 44(2), April 2010, pp. 35-40 (DOI 10.1145/1773912.1773922 in Crossref). That version is behind the ACM paywall and was not read, so what follows is the LADIS text only. The PDF is a short draft: it still carries the ACM template's "200X" copyright placeholder.

The problem is Facebook's Inbox Search, which lets users search their inbox. The system had to absorb a very high write throughput (billions of writes per day) and scale with the number of users, and, since users are served from geographically distributed data centers, replicate across data centers to keep search latency down. It launched in June 2008 for around 100 million users, and the paper says it had passed 250 million.

The authors call Cassandra "a synthesis of well known techniques". The related-work section sets it against [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) (gossip membership, but vector clocks and a read-before-write the authors consider limiting for heavy write loads), [Bigtable](/papers/bigtable-distributed-storage-system-structured-data) (structure and distribution, but durability delegated to a distributed file system) and the [Google File System](/papers/google-file-system), whose master is made fault tolerant with [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems). Worth knowing first: consistent hashing, quorums, and the Dynamo and Bigtable papers.

## Contribution

- **Data model.** A table is a distributed multi-dimensional map indexed by a row key (typically 16 to 36 bytes). Every operation under one row key is atomic per replica. Columns are grouped into column families, simple or super (a column family inside a column family), addressed as `family:column` or `family:super_column:column`. Columns sort by time or by name, which Inbox Search uses to show results in time order. The API has three calls: `insert(table, key, rowMutation)`, `get(table, key, columnName)` and `delete(table, key, columnName)`.
- **Partitioning.** Consistent hashing over a ring with an order-preserving hash function. Instead of Dynamo's multiple positions per node, lightly loaded nodes move on the ring to relieve heavy ones, an approach from [Chord](/papers/chord-scalable-peer-to-peer-lookup-service).
- **Replication.** Each key has a coordinator that replicates it at N-1 other nodes, with "Rack Unaware", "Rack Aware" and "Datacenter Aware" policies. A leader elected through [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) assigns ranges so no node holds more than N-1 ranges. The set of replicas for a range is called, borrowing from Dynamo, the preference list.
- **Membership and failure detection.** Scuttlebutt, an anti-entropy gossip mechanism, spreads membership and other control state. A modified Φ accrual failure detector turns gossip inter-arrival times into a suspicion level instead of a boolean. The authors found the exponential distribution a better fit than the Gaussian and claim the first such detector in a gossip setting.
- **Local persistence.** A commit log, an in-memory structure, immutable sorted data files, a Bloom filter per file and Bigtable-like compaction.

## Methodology

The paper is a system description plus experience notes, not an experimental study. Section 5 walks through partitioning, replication, membership, bootstrapping, scaling and local persistence. Section 5.7 gives implementation details: Java, a SEDA-style staged pipeline, non-blocking I/O, UDP for control messages and TCP for replication and routing. Section 6 collects lessons and one production case, Inbox Search, with a single table of measured read latencies. There is no benchmark suite (no YCSB) and no comparison with another system.

## Findings

Everything below is the authors' own account.

- **Write path.** A write goes to a commit log, on a dedicated disk because the writes are sequential, and only afterwards to an in-memory structure. When that structure crosses a size-and-object-count threshold it is dumped to disk with a row-key index. Logs roll at a configurable size, and 128MB "seems to work very well". A "fast sync" mode buffers log writes and risks data loss on a crash.
- **Read path.** Read the in-memory structure first, then the files from newest to oldest, with a per-file in-memory Bloom filter to skip files lacking the key. Column indices are written every 256K, and blocks hold at most 128 keys. Compaction merges files of similar size (never a 100GB file with one under 50GB), with periodic major compactions. Reads and writes are "practically lockless" because files are never mutated. The paper does not use the names memtable or SSTable.
- **Request flow.** Any node can receive a request. Writes wait for a quorum if synchronous, or are asynchronous for throughput-heavy uses. Reads go to the closest replica or to all and wait for a quorum, "based on the consistency guarantees required by the client". The latest response by timestamp wins, and stale replicas are repaired.
- **Failure detection.** In a 100-node experiment, the failure detectors the authors tried first, including [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol) and a gossip-style one, took about two minutes to detect a failed node. The accrual detector with Φ set to 5 took about 15 seconds. Φ of 1, 2 and 3 correspond to roughly 10%, 1% and 0.1% chance of a mistaken suspicion.
- **Inbox Search.** Seven TB of inbox data for over 100M users were loaded from MySQL through Map/Reduce jobs. Production: 50+TB on a 150-node cluster across east and west coast data centers. Bootstrap streaming moves about 40 MB/s from a single node.

| Latency | Interactions | Term search |
| --- | --- | --- |
| Min | 7.69 ms | 7.78 ms |
| Median | 15.69 ms | 18.27 ms |
| Max | 26.13 ms | 44.41 ms |

## Critical Analysis

What the paper does not say matters as much as what it does.

- **Consistency is thin.** Reads are "closest replica or quorum", but the text never gives quorum sizes, never names levels, and does not state what a read returns after a quorum write. Concurrent updates resolve by timestamp, with no vector clocks and no discussion of clock skew. Atomicity is per key per replica, and cross-key transactions were an open request. Hinted handoff and Merkle-tree anti-entropy for data are not mentioned.
- **The evidence is one table.** The conclusion says the authors "empirically demonstrated" very high update throughput with low latency, yet the paper reports only read latency for one application: no write throughput, no scaling curve, no failure experiment beyond detection time. Min, median and max are given without percentiles, and no load or hardware is stated.
- **Engineering paper, no outside evaluation.** All claims come from the system's builders, and the comparisons with Dynamo and Bigtable are descriptive. A six-page draft cannot detail repair, deletion or compaction costs, and the paper says repairing nodes after disk failures is only "an administrative operation".
- **Centralized pieces.** The authors note some coordination is essential and lean on ZooKeeper for leader election, range metadata and token storage, so "decentralized" has limits.

Later literature, read from the Apache Cassandra documentation (cassandra.apache.org, architecture, Dynamo page), not from a paper: it describes writes sent to all replicas regardless of consistency level, with levels such as ONE, QUORUM and ALL only deciding how many responses the coordinator awaits, last-write-wins resolution, hinted handoff, and virtual nodes (multiple tokens per node), which replace the load-driven ring movement described here. The OSR version and other later papers were not read.

## Further Research

- What does a client actually observe under "closest replica" reads, and how stale can they be?
- How does the time-sorted super column model compare with later wide-column designs?
- How well does the accrual detector hold up at thousands of nodes, beyond the 100-node test?
- Where do the compaction policy and Bloom filter sizes stop being a net win for read-heavy loads?

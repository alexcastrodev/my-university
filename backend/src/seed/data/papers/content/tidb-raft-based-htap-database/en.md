---
title: "TiDB: A Raft-based HTAP Database"
summary: A distributed SQL database that serves transactions and analytics from the same data by replicating Raft logs to a columnar store through learner nodes.
researchArea: Databases
keywords: htap, raft, consensus, distributed transactions, columnar storage, newsql
version: 1.2
updatedAt: 2026-10-31
---

## Overview

HTAP (hybrid transactional and analytical processing) databases try to run short transactions and heavy analytical queries on the same data. The hard part is isolation: analytical queries should read fresh and consistent data without slowing down the transactions.

This VLDB 2020 paper from PingCAP presents TiDB, an open source distributed SQL database built to do this. Its central idea is to extend Raft, the consensus algorithm, so that one data set can have a row-format copy for transactions and a column-format copy for analytics, both consistent.

## Contribution

The core contribution is the **learner** role added to Raft. A learner receives the replicated log asynchronously, does not vote in elections and is not part of the quorum, so it adds no wait to a write. Learners turn rows into columns and form a column store (TiFlash) that can be updated in real time and deployed on separate resources from the row store (TiKV).

Around that the paper describes a stateless SQL layer with a cost-based optimizer that can choose between the row and the column replica for each query, and TiSpark to connect to the Hadoop ecosystem.

## Methodology

The system has four parts: the TiDB SQL servers, the TiKV row store, the TiFlash column store, and the Placement Driver (PD), which stores metadata, schedules data and acts as a timestamp oracle.

Data is split into Regions, each a Raft group (multi-Raft). Transactions use a two-phase commit based on Percolator, with start and commit timestamps requested from PD, and give snapshot isolation. Reads from TiKV leaders are linearizable, and the paper describes read index, lease read and follower read to speed them up.

A read from TiFlash asks the leader for the newest read index and waits until the learner has applied that log position, which is how consistency is enforced at read time instead of at write time. The evaluation uses CH-benCHmark on a cluster of six servers (two Xeon E5-2630 v4 processors and 188 GB of memory each).

## Findings

These are the authors' reported results.

- The log replication delay between TiKV and TiFlash stayed under 300 ms with 10 warehouses, mostly under 100 ms, and mostly under 1,000 ms with 100 warehouses.
- Getting timestamps from PD is not a bottleneck: the authors measure over 600,000 timestamps per second per server, more than 100 times what TPC-C needs.
- On OLTP workloads, TiDB reached higher throughput than CockroachDB in most cases, especially with optimistic locking on larger data sets.
- Under CH-benCHmark, the authors report that TiDB keeps high performance for both transactional and analytical work while the two run isolated from each other. The paper also compares its analytical engine with Greenplum, Presto and SparkSQL on the analytical queries of the benchmark.

## Critical Analysis

The design is clear about why asynchronous replication plus a read-time check gives both freshness and isolation, and the learner idea is simple enough to reuse.

Points to read carefully:

- The authors are the system's developers, and the experiments are on CH-benCHmark, a synthetic mix. How the isolation holds with skewed data, schema changes or very large analytical scans is less visible.
- Freshness comes with a wait: a read from TiFlash may have to wait for log application, so the replication delay shows up as read latency under load.
- The comparison with CockroachDB covers OLTP, and the paper itself notes that CockroachDB offers serializability, a stronger isolation level than the snapshot isolation of TiDB, and has no dedicated analytical engine, so the two are not aiming at the same thing.
- Keeping both a row copy and a column copy adds storage and the work of keeping them in sync, a cost to weigh against a single-engine design.

## Further Research

- Handling heavier write rates and schema changes in the log-to-column transformation without growing the delay.
- Placing row and column replicas to balance cost, isolation and freshness automatically.
- A fair HTAP benchmark and methodology, since results depend a lot on the workload mix.
- Comparing a learner-based design with systems that keep one storage format and use other isolation techniques.

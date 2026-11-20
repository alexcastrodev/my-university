---
title: "CockroachDB: The Resilient Geo-Distributed SQL Database"
summary: CockroachDB stores SQL tables as ordered key-value ranges, replicates each range with Raft, and runs serializable MVCC transactions on hybrid logical clocks, so a cluster spread across regions needs only NTP-grade clocks instead of atomic clocks.
researchArea: Databases
keywords: distributed SQL, serializable isolation, hybrid logical clocks, Raft, range leases, geo-partitioning, MVCC, uncertainty interval
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

We live in an increasingly interconnected world, with many organizations operating across countries or even continents. To serve their global user base, organizations are replacing their legacy DBMSs with cloud-based systems capable of scaling OLTP workloads to millions of users. CockroachDB is a scalable SQL DBMS that was built from the ground up to support these global OLTP workloads while maintaining high availability and strong consistency. Just like its namesake, CockroachDB is resilient to disasters through replication and automatic recovery mechanisms. This paper presents the design of CockroachDB and its novel transaction model that supports consistent geo-distributed transactions on commodity hardware. We describe how CockroachDB replicates and distributes data to achieve fault tolerance and high performance, as well as how its distributed SQL layer automatically scales with the size of the database cluster while providing the standard SQL interface that users expect. Finally, we present a comprehensive performance evaluation and share a couple of case studies of CockroachDB users. We conclude by describing lessons learned while building CockroachDB over the last five years.

## Overview

This is an industry paper (SIGMOD 2020, 17 pages) by 17 authors from Cockroach Labs. The problem is a transactional SQL database that is open source (Business Source License, converting to Apache 2.0 after three years), serializable, survives disk, rack, datacenter and region failures, lets users pin data to places for latency and regulation (GDPR is the running example), and runs on off-the-shelf servers with NTP-style clock sync. [Spanner](/papers/spanner-globally-distributed-database) offers the strongest guarantees but, as the paper says, is practical only where specialized hardware bounds clock uncertainty to a few milliseconds.

The design is five layers inside every node (shared-nothing, any node accepts clients): SQL (parser, optimizer, executor); Transactional KV (atomicity and isolation); Distribution (one ordered key space cut into ~64 MiB "Ranges"); Replication (each Range is a [Raft](/papers/raft-understandable-consensus-algorithm) group, three replicas by default); Storage (a local KV store; RocksDB at the time, treated as a black box, with a redesigned storage layer announced). Tables and secondary indexes map to ordered key-value pairs, and a Range lease picks one replica, the leaseholder, to serve reads and propose writes.

Worth knowing first: MVCC, serializability against snapshot isolation (see [Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels)), and the clocks in [Hybrid Logical Clocks](/papers/logical-physical-clocks).

## Contribution

- **Transaction protocol without special hardware.** Transactions read and write at a commit timestamp from a hybrid logical clock. Conflicts may push that timestamp forward, and a "read refresh" checks the earlier reads are still valid at the new one, otherwise the transaction restarts. Isolation is SERIALIZABLE by default.
- **Write intents and transaction records.** Writes are provisional MVCC values pointing to a per-transaction record (pending, staging, committed, aborted) whose change flips every intent at once.
- **Write Pipelining and Parallel Commits.** The coordinator answers without waiting for each write to replicate, and a "staging" status lets the commit replicate in parallel with the writes, so many multi-statement transactions finish in one round of consensus. The authors verified atomicity and durability of Parallel Commits with TLA+.
- **Clocks and leases.** HLC with a configurable maximum offset (default 500 ms) and an uncertainty interval give single-key linearizability. Leases are kept disjoint, and each Raft write carries its lease sequence number, which protects isolation even when the offset bound is broken.
- **Placement policies.** Geo-Partitioned Replicas, Geo-Partitioned Leaseholders and Duplicated Indexes, plus follower reads (`AS OF SYSTEM TIME`) from closed timestamps. The paper has no REGIONAL BY ROW syntax.
- **SQL layer.** A Cascades-style optimizer (200+ rules, written in the Optgen DSL, aware of partitioning), distributed read-only execution, a vectorized engine, and F1-style online schema changes.

## Methodology

CockroachDB v19.2 on AWS and GCP. Parallel Commits: a microbenchmark of single-row writes on three servers in three regions. Scalability: Sysbench point selects and inserts (3 nodes with 2 to 36 vCPUs, then 3 to 48 nodes of c5d.9xlarge) and TPC-C with varying remote-transaction percentage and replication factor. TPC-C on 1,000, 10,000 and 100,000 warehouses is compared with Amazon Aurora numbers published by AWS. Availability: TPC-C 1,000 on 9 GCP machines in three US regions with induced AZ and region failures under four placement policies. The Spanner comparison uses YCSB A to F in one region over three AZs. Two customer case studies close the evaluation.

## Findings

All figures below are the authors' own; "chart reading" marks values the text does not state.

- **Parallel Commits.** Up to 72% more throughput and up to 47% lower p50 latency on single-row writes with secondary indexes, and the latency profile stays flat as indexes are added.
- **Scalability.** Throughput per vCPU stays nearly constant from 6 to 1,728 vCPUs (stated in the text; the chart gives no per-point numbers). Replication costs up to 48% of TPC-C throughput with three replicas and 57% with five, distributed transactions up to 46% more, yet all variants scale linearly with cluster size (10,000 warehouses is 800 GB).
- **TPC-C versus Aurora (Table 1).** CockroachDB reaches 12,474 tpmC (1,000 warehouses, 3 nodes), 124,036 (10,000, 15 nodes) and 1,245,462 (100,000, 81 nodes, ~8 TB), with NewOrder p90 of 39.8, 436.2 and 486.5 ms. Efficiency is printed as 97.0%, 96.5% and 98.8%. Aurora is quoted at 12,582 tpmC (97.8%) and 9,406 (7.3%), with no latency or hardware reported.
- **Failures and placement.** All four policies tolerate an AZ failure; only Geo-Partitioned Leaseholders survives a region failure, at higher p90 latency in stable operation. Duplicated Indexes has the lowest p90 in stable conditions (chart reading, Fig. 6).
- **Versus Spanner.** CockroachDB shows higher YCSB throughput on most workloads, except Workload A (high contention), and lower latency at all percentiles under light load, which the authors attribute in part to Spanner's commit-wait. No latency numbers are in the text.
- **Clock skew.** Beyond the offset bound, serializability holds but single-key linearizability can break, and a node whose clock is too far off from a majority self-terminates.

## Critical Analysis

The paper states some limits itself.

- **Not strict serializability.** Transactions on disjoint keys may be ordered differently from real time, and stale reads are possible if skew exceeds the bound. Only the bound-respecting case gives single-key linearizability.
- **Contention.** Workload A does not scale, and the authors expect optional read locking in release 20.1 to help. Read refreshes can give false positives, and clients must still handle retries.
- **Distributed SQL is read-only.** Writes execute in gateway-only mode. Snapshot isolation was dropped to an alias of SERIALIZABLE, and "Follow the Workload" is rarely used.

My reading, not claims of the paper:

- **Vendor evidence.** One company, its own benchmarks and its own deployment choices. The comparisons with Spanner, Aurora, TiDB and F1 are mostly qualitative. Aurora's figures come from AWS, with different hardware and unknown tuning, and Spanner's hardware is undisclosed, so the match is by cost (0.2%) only.
- **Table 1 does not add up.** At 100,000 warehouses 1,245,462 tpmC over 12.86 tpmC per warehouse gives about 96.8%, not 98.8%. Probably a typo, but the text does not say.
- **Formal scope.** TLA+ covers Parallel Commits (atomicity and durability) only. The clock-skew safeguards, the HLC argument and the rest are argued in prose, with no proof or model checking reported.
- **Later literature, read only through this catalog.** The catalog's analysis of Pesto says CockroachDB served there as an unreplicated, in-memory baseline, and its analysis of [TiDB](/papers/tidb-raft-based-htap-database) says TiDB was faster on most OLTP runs while CockroachDB is serializable. I did not read those originals, and they do not test this paper's claims.

## Further Research

- Contention under SERIALIZABLE: how much do pessimistic read locks and read refreshes change retry rates on skewed workloads?
- Measured cost of the maximum offset: how often do real clouds violate 500 ms, and how often do uncertainty restarts occur?
- Independent tests of the isolation and linearizability claims under skew and partitions, for example with [Elle](/papers/elle-inferring-isolation-anomalies-from-experimental-observations) (I did not check whether this has been done).
- Compare with deterministic ([Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases)), timestamp-based ([Tiga](/papers/tiga-accelerating-geo-distributed-transactions-with-synchronized-clocks)) and unbundled ([FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store)) designs under one workload.
- Write intents plus a per-transaction record echo the lock-based commit of [Percolator](/papers/percolator-large-scale-incremental-processing). The paper does not cite it, so this link is my own reading.

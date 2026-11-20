---
title: "Amazon Aurora: Design Considerations for High Throughput Cloud-Native Relational Databases"
summary: Aurora keeps the MySQL/InnoDB engine but moves redo logging, page materialization and crash recovery into a distributed storage service, so that only redo log records cross the network and durability comes from a 4 of 6 write quorum across three availability zones.
researchArea: Databases
keywords: cloud-native database, redo log, quorum replication, log-structured storage, crash recovery, read replicas, mysql, storage disaggregation
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Amazon Aurora is a relational database service for OLTP workloads offered as part of Amazon Web Services (AWS). In this paper, we describe the architecture of Aurora and the design considerations leading to that architecture. We believe the central constraint in high throughput data processing has moved from compute and storage to the network. Aurora brings a novel architecture to the relational database to address this constraint, most notably by pushing redo processing to a multi-tenant scale-out storage service, purpose-built for Aurora. We describe how doing so not only reduces network traffic, but also allows for fast crash recovery, failovers to replicas without loss of data, and fault-tolerant, self-healing storage. We then describe how Aurora achieves consensus on durable state across numerous storage nodes using an efficient asynchronous scheme, avoiding expensive and chatty recovery protocols. Finally, having operated Aurora as a production service for over 18 months, we share lessons we have learned from our customers on what modern cloud applications expect from their database tier.

## Overview

This SIGMOD 2017 paper from Amazon Web Services describes a production database, not a research prototype: Aurora became generally available in July 2015. Its starting point is that in a cloud fleet, I/O is spread over many nodes and disks, so individual disks are no longer hot. The bottleneck moves to the network between the database tier and the storage tier, and replicating a traditional database's writes across zones multiplies the packets per second and puts synchronous steps on the critical path.

Aurora is one answer in the family of cloud databases covered in the catalog. [TiDB](/papers/tidb-raft-based-htap-database) and [FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store) also separate components and replicate, but with Raft groups or an unbundled transaction layer. [Spanner](/papers/spanner-globally-distributed-database), which Aurora cites and describes as relying on two-phase commit and two-phase locking for read/write transactions, takes another path: Aurora keeps a single writer and a single ordered log. Useful background: the [log-structured file system](/papers/log-structured-file-system) idea that the log is the primary record, and quorum replication as in [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) (the paper itself uses the DynamoDB service only as a metadata store for the storage control plane).

## Contribution

The paper lists three contributions: reasoning about durability at cloud scale with quorums that survive correlated failures; offloading the lower quarter of a traditional database kernel to smart storage; and removing multi-phase synchronization, crash recovery and checkpointing from distributed storage.

- **Quorum sized for a zone failure.** Each item is replicated 6 ways across 3 availability zones (2 copies per zone), with write quorum Vw = 4 and read quorum Vr = 3. The paper argues that a 2 of 3 quorum is inadequate because losing a zone plus any concurrent node failure breaks it. Aurora tolerates losing a zone and one more node without losing data, and losing a zone without losing the ability to write.
- **The log is the database.** The only writes that cross the network from the database tier are redo log records. No pages are written for background writes, checkpoints or eviction. Storage nodes apply the log to produce pages in the background or on demand, and pages are described as "a cache of log applications".
- **Asynchronous consensus on durable state.** Instead of 2PC, the database advances points of consistency and durability as acknowledgements arrive.

## Methodology

**Segments.** The volume is cut into 10 GB segments, each replicated 6 ways into a Protection Group (PG). The paper says a 10 GB segment can be repaired in 10 seconds on a 10 Gbps link, which shrinks the window for a double fault. Volumes can grow up to 64 TB.

**Storage node.** Of eight activities, only receiving a record into the queue and persisting it with an acknowledgement are on the foreground path. Gap detection, gossip with peers to fill missing records, coalescing records into pages, staging to S3, garbage collection and CRC scrubbing are background work.

**LSN bookkeeping.** Each record has a monotonically increasing LSN. A segment tracks the SCL (Segment Complete LSN) using per-PG backlinks. The storage service computes the VCL (Volume Complete LSN), the highest LSN with all prior records available. The database tags the last record of each mini-transaction as a CPL (Consistency Point LSN). The VDL (Volume Durable LSN) is the highest CPL not above the VCL, and records above it are truncated. The paper's example: complete to 1007 but CPLs at 900, 1000 and 1100 means durable only to 1000. LSN allocation is capped at VDL plus the LSN Allocation Limit (10 million) for back-pressure.

**Commit and reads.** Commit is asynchronous: a transaction waits in a list until the VDL reaches its commit LSN, and worker threads do not block. Reads use single-segment reads at a read point, not quorum reads. A page is evicted only if its page LSN is at least the VDL.

**Recovery.** There is no checkpoint and no redo replay at startup. After a crash the database reads a read quorum per PG, recomputes the VDL and writes truncation ranges versioned by epoch numbers. Undo recovery runs while the database is online.

**Replicas.** One writer and up to 15 read replicas mount the same volume. The log stream is also sent to replicas, which apply only records with LSN at most the VDL and apply each mini-transaction atomically.

## Findings

These are the authors' reported results. Benchmarks ran on r3.8xlarge instances unless stated, with MySQL on EBS with 30K provisioned IOPS; Aurora was based on MySQL 5.6.

- **Network I/O (Table 1).** SysBench write-only, 100 GB, 30 minutes: mirrored MySQL ran 780,000 transactions at 7.4 I/Os per transaction, Aurora 27,378,000 at 0.95. The paper reports 35 times more transactions, 7.7 times fewer I/Os per transaction on the database node despite sixfold write amplification, and 46 times fewer I/Os at the storage tier.
- **Instance size (Figures 6 and 7).** Throughput roughly doubles with each size. At r3.8xlarge the text gives Aurora 121,000 writes/sec and 600,000 reads/sec, 5x MySQL 5.7. The text assigns MySQL 5.7 "20,000 reads/sec and 125,000 writes/sec", which looks swapped against the charts (reading the chart, about 125,000 reads and 20,000 writes: leitura de gráfico).
- **Data size (Table 2), write-only writes/sec.** Aurora 107,000 / 107,000 / 101,000 / 41,000 versus MySQL 8,400 / 2,400 / 1,500 / 1,200 for 1 GB, 10 GB, 100 GB and 1 TB: up to 67x at 100 GB and 34x at 1 TB.
- **Connections (Table 3), writes/sec.** At 50, 500 and 5,000 connections Aurora 40,000, 71,000, 110,000 versus MySQL 10,000, 21,000, 13,000.
- **Replica lag (Table 4), msec.** At 1,000 to 10,000 writes/sec Aurora grows from 2.62 to 5.38 versus MySQL from under 1,000 to 300,000.
- **TPC-C variant (Table 5).** Aurora sustains 2.3x to 16.3x the tpmC of MySQL 5.7; for example 73,955 versus 25,289 at 500 connections, 10 GB, and 42,181 versus 2,592 at 5,000 connections, 10 GB.
- **Recovery.** Only one statement, no figure or table: recovery is "generally under 10 seconds" even after a crash under over 100,000 write statements per second.
- **Customers.** A gaming company's average response time went from 15 ms to 5.5 ms. An education company's P95 latencies (40 to 80 ms) came close to P50 (about 1 ms); its replica lag spiked to 12 minutes on MySQL and stayed under 20 ms across 4 Aurora replicas.

## Critical Analysis

The central argument is clear and well supported: once the network is the bottleneck, writing only redo records and replicating at the storage tier cuts traffic even with six copies. Keeping concurrency control and isolation in the engine, as if on local disk, limits how much changes. Points to read carefully:

- The authors run the service, and it is closed source. The numbers cannot be reproduced from the paper.
- The baseline is MySQL 5.6 and 5.7 on mirrored EBS. The related work discusses Deuteronomy, Hyder, Sinfonia and Yesquel only in prose: there is no measured comparison with other cloud-native or distributed databases.
- The durability argument ("sufficiently unlikely" double faults) is qualitative, with no failure-rate data. The repair and gossip mechanisms are described, not evaluated, and recovery has one sentence of evidence.
- The design assumes a single writer with LSNs from one ordered domain, which is also what lets Aurora offer the same isolation levels as MySQL. Multiple writers are not addressed. Compare this with the consistency trade-offs in [PACELC](/papers/consistency-tradeoffs-in-modern-distributed-database-system-design), [CAP](/papers/brewers-conjecture-cap-feasibility-web-services) and [Highly Available Transactions](/papers/highly-available-transactions-virtues-and-limitations), which the paper cites.
- Small inconsistencies: the 5.7 figures above, and the text of section 6.2.2 says 95th percentile "(P99)" once while the figures say P95. The customer cases are single before and after migrations, with no controlled experiment.

## Further Research

- Later work by the same team: the SIGMOD 2018 paper "Amazon Aurora: On Avoiding Distributed Consensus for I/Os, Commits, and Membership Changes" (Crossref confirms authors, venue and title; later literature, not read).
- Topics the paper raises in Lessons Learned: schema evolution with online DDL, zero-downtime patching, and multi-tenant consolidation.
- Another cloud database with separated storage, Socrates (SIGMOD 2019, "The New SQL Server in the Cloud"): later literature, only title and metadata checked, not read.
- A reproducible comparison with other disaggregated designs, measuring recovery time and repair, which the paper only describes.

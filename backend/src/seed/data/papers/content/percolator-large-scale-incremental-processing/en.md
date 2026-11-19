---
title: "Large-scale Incremental Processing Using Distributed Transactions and Notifications"
summary: Percolator adds multi-row snapshot-isolation transactions and change-triggered observers on top of Bigtable, so Google could update its web index one document at a time instead of rebuilding it with chains of MapReduces.
researchArea: Distributed Systems
keywords: percolator, incremental processing, snapshot isolation, two-phase commit, bigtable, timestamp oracle, observers
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Updating an index of the web as documents are crawled requires continuously transforming a large repository of existing documents as new documents arrive. This task is one example of a class of data processing tasks that transform a large repository of data via small, independent mutations. These tasks lie in a gap between the capabilities of existing infrastructure. Databases do not meet the storage or throughput requirements of these tasks: Google's indexing system stores tens of petabytes of data and processes billions of updates per day on thousands of machines. MapReduce and other batch-processing systems cannot process small updates individually as they rely on creating large batches for efficiency. We have built Percolator, a system for incrementally processing updates to a large data set, and deployed it to create the Google web search index. By replacing a batch-based indexing system with an indexing system based on incremental processing using Percolator, we process the same number of documents per day, while reducing the average age of documents in Google search results by 50%.

## Overview

Before this work, Google's web index was built by feeding each day's crawl, together with the existing repository, through a series of 100 MapReduces ([MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters)). That works because a batch step finishes before the next starts, so invariants such as "only the highest-PageRank URL among duplicates stays in the index" are easy to keep. The cost is that a small update forces a rescan of everything: latency tracks the size of the repository, not the size of the update. A conventional DBMS could update single documents transactionally, but not at tens of petabytes. A store such as [Bigtable](/papers/bigtable-distributed-storage-system-structured-data) scales, but gives no help with invariants under concurrent updates.

This OSDI 2010 paper, by Daniel Peng and Frank Dabek of Google, describes Percolator, which sits between the two. It runs on Bigtable (itself stored on the [Google File System](/papers/google-file-system)), adds ACID transactions across rows and tables with snapshot isolation, and adds observers, code the system runs when a column changes. The indexing system rebuilt on it is known as Caffeine, and the paper says Percolator has produced Google's web search index since April 2010.

Worth knowing first: snapshot isolation and why it allows write skew (see [A Critique of ANSI SQL Isolation Levels](/papers/critique-of-ansi-sql-isolation-levels)), two-phase commit, Bigtable's single-row transactions and timestamped cells, and the batch model of MapReduce.

## Contribution

- **Cross-row transactions as a client library.** Percolator has no transaction server. Any client can write to Bigtable directly, so locks live in Bigtable columns and the client coordinates a two-phase commit through Bigtable row transactions.
- **Lock, write and data columns.** Each Percolator column is stored as three Bigtable columns: `data` (the value at the start timestamp), `lock` (an uncommitted writer, with the location of the primary lock) and `write` (a pointer to the timestamp where committed data lives). A transaction commits when it replaces the primary lock with a write record.
- **A timestamp oracle.** A server hands out strictly increasing timestamps. Every transaction contacts it twice, for a start and a commit timestamp, and the snapshot isolation guarantee depends on that ordering.
- **Lazy lock cleanup.** One cell per transaction is the primary lock, the single point where commit and cleanup race. A transaction that finds a stranded lock looks at the primary to decide between rolling back and rolling forward.
- **Observers and notifications.** Observers run when a watched column changes, with a per-observer acknowledgment column giving at most one committed run per change. Applications are chains of observers writing to the table, and the paper says the indexing system has roughly 10.

## Methodology

A Percolator cluster runs three binaries on every machine: a worker (with all observers linked in), a Bigtable tablet server and a GFS chunkserver, plus two small services: the timestamp oracle and a lightweight lock service used to spread notification scanning. Commit follows Figure 6 of the paper. Prewrite checks each written cell for a `write` record after the start timestamp or any `lock`, aborting on either, then writes lock and data at the start timestamp, primary first. The client then gets a commit timestamp, replaces the primary lock with a write record (the commit point), and finishes the secondaries. A `Get` waits if it sees a lock at or before its start timestamp, and otherwise reads the latest write record.

Liveness of a lock's owner is judged with a token in [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) plus a wall time stored in the lock. Notifications use a `notify` column in its own locality group, scanned by threads that start at random tablet positions. Four mechanisms cut cost: conditional mutations, batching of RPCs, prefetching of columns in the same row, and thousands of blocking threads per machine.

The evaluation is on a subset of servers in one Google data center. It has three parts: the conversion of the indexing pipeline, a synthetic clustering benchmark (240 machines, a billion-document repository, three clustering keys) against MapReduce, and microbenchmarks and a TPC-E-like workload against raw Bigtable.

## Findings

These are the authors' reported results.

- **Production indexing.** The old system crawled several billion documents a day through 100 MapReduces, and each document spent 2 to 3 days being indexed. Caffeine processes the median document over 100x faster, with a collection 3x larger and about twice the resources. It uses 10 observers in place of 100 MapReduces and is described as essentially immune to the stragglers that hurt the batch system. The average document in search results is nearly 50% younger, a figure that includes crawl delay.
- **Clustering benchmark.** At a 1% crawl rate the MapReduce sequence needs about 20 minutes per run and about 30 minutes on average from crawl to clustering, while Percolator takes two seconds on average, roughly 1000x faster. Percolator falls behind at a 40% crawl rate per hour, while MapReduce in this setup sustains more than 100%. The authors expect the cross-over to favor MapReduce at high crawl rates.
- **Microbenchmark.** Against one tablet server, Percolator reads 14,590 per second against Bigtable's 15,513 (0.94) and writes 7,232 against 31,003 (0.23), a factor of about four on single-cell writes. Batching was disabled and the oracle was not exercised.
- **TPC-E-like.** Transaction rate grows essentially linearly from 11 to 15,000 cores. At 15,000 cores it performs 11,200 tps, against 3,183 tpsE for the fastest commercial system the authors cite. They estimate about 30 times more CPU per transaction. Average latency is 2 to 5 seconds, with outliers of several minutes.
- **Other numbers.** The oracle serves around 2 million timestamps per second from one machine. A document takes around 50 Bigtable operations. Prefetching and caching cut reads by a factor of 10. After killing a third of the tablet servers, throughput drops and then recovers as tablets reload.

## Critical Analysis

The paper states its own limits. Snapshot isolation is not serializable. Lazy cleanup can delay a commit by tens of seconds, acceptable for indexing but not for OLTP. There is no global deadlock detector. Cross-data-center replication is limited, since Bigtable's replication is consistent only per tablet. The 30x CPU overhead is called a cost of layering. Batching widens the window for conflicts, which the authors say was not a problem in a low-contention setting. For the TPC-E-like run, the authors omitted a write that would have hit a hot cell (the broker commission), noting that real use would go through a side table.

The following points are a reading of the evidence, not claims of the paper.

- **The headline gain has two bases.** The 100x figure for Caffeine is stated without a plot, and the 1000x figure comes from a synthetic benchmark whose baseline reruns three MapReduces over the whole repository. The related work names modified MapReduces and DryadInc as middle grounds that were not run.
- **The crash path is described, not measured.** The cleanup and roll-forward protocol is explained in detail, but there are no counts of stranded locks, cleanup aborts or time to recover a stuck commit. The only failure experiment kills tablet servers, which the paper says do not affect transaction correctness.
- **Single-cell writes are a worst case, not a typical one.** The factor of four comes with batching off and data in cache, so it says little about what batching buys.

Later literature, not part of the paper: [TiDB](/papers/tidb-raft-based-htap-database) is described in its own paper as using a two-phase commit based on Percolator with timestamps requested from its PD component, and giving snapshot isolation. [Spanner](/papers/spanner-globally-distributed-database) took another path to stronger semantics, TrueTime and commit wait, with replication across data centers built in. [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) avoids two-phase commit altogether with deterministic ordering.

## Further Research

- The open question the authors end on: how much of the 30-fold overhead is inherent to layering over distributed storage, and how much can be optimized away?
- Hot-spot handling beyond omitting writes: weak notifications and side tables are described, but the paper gives no numbers for their effect.
- Replicating a Percolator-style repository across data centers without breaking invariants between writes of one transaction.
- A direct comparison with a stronger incremental MapReduce baseline at the same repository sizes.

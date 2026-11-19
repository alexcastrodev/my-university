---
title: "Resilient Distributed Datasets: A Fault-Tolerant Abstraction for In-Memory Cluster Computing"
summary: Zaharia and colleagues propose RDDs, read-only partitioned datasets built by coarse-grained transformations, so that a cluster can keep data in memory across computations and recover lost partitions by replaying lineage instead of replicating data. Implemented in Spark, the model is reported to beat Hadoop by up to 20× on iterative jobs.
researchArea: Distributed Systems
keywords: resilient distributed datasets, spark, lineage, in-memory computing, narrow and wide dependencies, fault tolerance, iterative algorithms
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

We present Resilient Distributed Datasets (RDDs), a distributed memory abstraction that lets programmers perform in-memory computations on large clusters in a fault-tolerant manner. RDDs are motivated by two types of applications that current computing frameworks handle inefficiently: iterative algorithms and interactive data mining tools. In both cases, keeping data in memory can improve performance by an order of magnitude. To achieve fault tolerance efficiently, RDDs provide a restricted form of shared memory, based on coarse-grained transformations rather than fine-grained updates to shared state. However, we show that RDDs are expressive enough to capture a wide class of computations, including recent specialized programming models for iterative jobs, such as Pregel, and new applications that these models do not capture. We have implemented RDDs in a system called Spark, which we evaluate through a variety of user applications and benchmarks.

## Overview

By 2012 MapReduce and Dryad were widely adopted, but the only way to reuse data between two jobs was to write it to a distributed file system, paying for replication, disk I/O and serialization. That hurts iterative machine learning and graph algorithms (PageRank, k-means, logistic regression) and interactive queries over the same subset of the data. This NSDI 2012 paper, from UC Berkeley (San Jose, April 2012), asks for a general abstraction for that reuse, instead of one specialized framework per pattern such as Pregel or HaLoop.

Context in this catalog: [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) is the batch model and re-execution idea the paper builds on, and it reads its input from a file system in the style of the [Google File System](/papers/google-file-system). A store such as [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), built around fine-grained cell updates, is the kind of workload the paper leaves to other systems (Section 2.4 names RAMCloud, Percolator and Piccolo).

Worth knowing first: the MapReduce model, what a shuffle is, the difference between logging updates and recomputing from inputs, and basic Scala closures.

## Contribution

- **The RDD abstraction.** A read-only, partitioned collection of records, created only by deterministic transformations (map, filter, join) on stable storage or other RDDs. An RDD records how it was derived (its lineage), so a program cannot reference an RDD it cannot rebuild after a failure. Users control persistence (memory, disk, replication, priority) and partitioning by key.
- **Lineage instead of replication.** Fault tolerance logs the transformations, not the data. A lost partition is recomputed from its parents, in parallel on other nodes, without rolling back the whole program.
- **Narrow and wide dependencies.** A narrow dependency means each parent partition feeds at most one child partition (map, filter, co-partitioned join), so it pipelines on one node and recovers cheaply. A wide dependency needs a shuffle (groupByKey, unpartitioned join), and one failure may force recomputing partitions of every ancestor.
- **A small common interface.** Five operations (partitions, preferredLocations, dependencies, iterator, partitioner, Table 3) let most transformations be written in under 20 lines without special scheduler logic.
- **Spark.** About 14,000 lines of Scala running on Mesos, with lazy transformations, actions (count, collect, reduce, save), a stage-based scheduler, LRU memory management and an interactive Scala interpreter. Pregel and HaLoop are each a 200-line library on top of it.

## Methodology

Section 2 defines RDDs and compares them with distributed shared memory (Table 1). Sections 3 and 4 show the API and the internal representation through log mining, logistic regression and PageRank. Section 5 covers the scheduler, interpreter, memory manager and checkpointing.

The scheduler turns the lineage graph of an action into a DAG of stages, cutting at shuffles and at partitions already in memory, pipelines narrow transformations inside a stage and places tasks with delay scheduling. Shuffle outputs are materialized on the parent nodes, like MapReduce map outputs. A failed task reruns elsewhere while its parent stage outputs exist, otherwise the missing partitions are recomputed. Scheduler failures are not tolerated yet.

The evaluation (Section 6) uses Amazon EC2, mostly m1.xlarge nodes (4 cores, 15 GB RAM), HDFS with 256 MB blocks and cleared OS caches. It compares Spark with Hadoop 0.20.2 and HadoopBinMem (binary data in an in-memory HDFS), 10 iterations over 100 GB on 25 to 100 machines, then PageRank, a failure test on 75 nodes, memory-limited runs, three user applications and interactive queries.

## Findings

All figures below are reported by the authors.

- **Logistic regression.** First iteration: Hadoop 80 s, HadoopBinMem 139 s, Spark 46 s. Later iterations on 100 machines: 76 s, 62 s and 3 s, so Spark is 25.3× and 20.7× faster than Hadoop and HadoopBinMem.
- **K-means.** First iteration 115 s, 182 s and 82 s. Later iterations: 106 s, 87 s and 33 s, a speedup of 1.9× to 3.2× over Hadoop across cluster sizes, because the job is compute-bound.
- **Why not just in-memory Hadoop.** Hadoop jobs cost at least 25 s even when doing nothing, HDFS adds about 2 s on a 256 MB input, text parsing about 7 s and conversion to Java objects about 3 s, which is nearly the cost of the regression itself. Spark stores deserialized objects.
- **PageRank.** On a 54 GB Wikipedia dump (about 4 million articles, 10 iterations), 30 nodes: Hadoop 171 s, basic Spark 72 s (2.4×), Spark with controlled partitioning 23 s (7.4×). On 60 nodes: 80 s, 28 s and 14 s.
- **Failure.** On 75 nodes with 100 GB, a node killed at the start of the 6th k-means iteration raised that iteration from about 58 s to 80 s, then it returned to 58 s. The lineage graphs were all under 10 KB.
- **Not enough memory.** Logistic regression on 100 GB and 25 machines: 68.8 s with 0% of the data in memory, 58.1 s at 25%, 40.7 s at 50%, 29.7 s at 75% and 11.5 s at 100%, a graceful degradation.
- **User applications.** A Conviva report on 200 GB of compressed data went from 20 hours on Hadoop to 30 minutes on two Spark machines (40×, 96 GB of RAM). Traffic modeling scaled nearly linearly from 20 to 80 nodes. Twitter spam classification (50 GB, 250,000 URLs, 10^7 features) scaled less well because of fixed communication cost.
- **Interactive use.** Scanning 1 TB of Wikipedia page views on 100 machines took 5 to 7 seconds per query, against 170 s from disk.

## Critical Analysis

The paper is explicit about its scope: Section 2.4 says RDDs are less suitable for asynchronous fine-grained updates to shared state, such as a storage system for a web application or an incremental web crawler, which it leaves to databases, RAMCloud, Percolator and Piccolo.

- **Wide dependencies are weakly measured.** The text says one failure can force full recomputation for long lineages with wide dependencies and recommends checkpointing, and the PageRank example shows exactly that pattern. The single failure experiment is on k-means, and automatic checkpointing is only under investigation.
- **The 20× headline is one workload.** K-means gains 1.9× to 3.2×, and PageRank 2.4× from memory alone. The comparison is against Hadoop 0.20.2 on the authors' configuration.
- **The failure test is small.** One node, one iteration, one application. Figure 11 labels the slow iteration 81 s while the text says 80 s.
- **Scheduler failures are not tolerated.** The paper only says replicating the lineage graph would be straightforward.
- **User application results are reports.** The Conviva and Monarch numbers come from user deployments and are not controlled comparisons.

Readings that are mine, not the paper's: recovery by recomputation relies on transformations being deterministic, and footnote 9 admits the planned debugger cannot replay nondeterministic user functions. The comparison with replication also assumes lineage is cheap to keep, shown only for jobs of tens of iterations.

What the paper does not claim: no streaming system (batched stream processing appears only as a possible use), no SQL engine (SQL is a planned use of the interpreter), no sharing of RDDs between Spark instances, and no guarantee for applications with fine-grained updates.

Later literature, not part of this PDF: Discretized Streams (SOSP 2013) treats streaming as small batch jobs on RDD-style datasets, with parallel recovery. Spark SQL (SIGMOD 2015) adds a declarative DataFrame API integrated with procedural Spark code, and a Catalyst optimizer. For streaming outside Spark, the catalog has the later [Dataflow Model](/papers/dataflow-model-unbounded-out-of-order-data) (2015), which targets unbounded, out-of-order data.

## Further Research

- Discretized Streams and Spark SQL, for streaming and relational processing built on the model. The Structured Streaming paper (SIGMOD 2018) continues that line and was not read for this analysis.
- Experiments on automatic checkpoint selection, which the paper lists as under investigation using the scheduler's knowledge of dataset sizes and computation times.
- Lineage-based debugging, the idea in Section 7.2 of re-running a task in a single-process debugger.
- Failure behavior with wide-dependency lineage under several simultaneous failures.
- Sharing RDDs across Spark instances through a unified memory manager, which the paper names as future work.

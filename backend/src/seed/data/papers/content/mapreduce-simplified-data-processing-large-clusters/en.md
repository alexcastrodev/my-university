---
title: "MapReduce: Simplified Data Processing on Large Clusters"
summary: Dean and Ghemawat describe a programming model in which the user writes only a map and a reduce function, and a library hides partitioning, scheduling, fault tolerance and communication across thousands of commodity machines, with re-execution as the main way to survive failures.
researchArea: Distributed Systems
keywords: mapreduce, batch processing, fault tolerance, re-execution, data locality, stragglers
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

MapReduce is a programming model and an associated implementation for processing and generating large data sets. Users specify a map function that processes a key/value pair to generate a set of intermediate key/value pairs, and a reduce function that merges all intermediate values associated with the same intermediate key. Many real world tasks are expressible in this model, as shown in the paper.

Programs written in this functional style are automatically parallelized and executed on a large cluster of commodity machines. The run-time system takes care of the details of partitioning the input data, scheduling the program's execution across a set of machines, handling machine failures, and managing the required inter-machine communication. This allows programmers without any experience with parallel and distributed systems to easily utilize the resources of a large distributed system.

Our implementation of MapReduce runs on a large cluster of commodity machines and is highly scalable: a typical MapReduce computation processes many terabytes of data on thousands of machines. Programmers find the system easy to use: hundreds of MapReduce programs have been implemented and upwards of one thousand MapReduce jobs are executed on Google's clusters every day.

## Overview

By 2004 the authors and many colleagues at Google had written hundreds of special-purpose programs that turn raw data (crawled documents, request logs) into derived data (inverted indices, graph representations of web pages, most frequent queries). Each computation was simple, but running it on hundreds or thousands of machines buried it under code for parallelization, data distribution and failure handling. This paper, presented at OSDI '04 in San Francisco in December 2004, proposes one abstraction, inspired by the map and reduce primitives of Lisp and other functional languages, that moves all of that into a library.

The cluster underneath is a set of commodity PCs with inexpensive IDE disks, where machine failures are common, and the data lives in Google's in-house distributed file system, GFS, which replicates it. The paper credits GFS as the place MapReduce reads its input from and writes its output to. Google's later infrastructure papers in this catalog, such as the [Chubby lock service](/papers/chubby-lock-service-loosely-coupled-distributed-systems) and [Spanner](/papers/spanner-globally-distributed-database), build on the same style of commodity-cluster engineering.

Worth knowing first: the functional notions of map and reduce, what a key/value pair is, and the difference between a task that can be safely re-run (idempotent, deterministic) and one that cannot.

## Contribution

- **A two-function interface.** `map (k1,v1) -> list(k2,v2)` and `reduce (k2,list(v2)) -> list(v2)`. The library groups all intermediate values by key and calls reduce once per key, passing the values through an iterator so that lists larger than memory work.
- **An implementation for large clusters of commodity machines.** A master assigns M map tasks and R reduce tasks to workers. Map output is partitioned into R regions on the map worker's local disk, reduce workers fetch it by remote procedure call, sort it by key and write the final output files.
- **Re-execution as the fault-tolerance mechanism.** A failed worker's tasks, and its completed map tasks (whose output sat on its local disk), simply run again elsewhere. Atomic commits of task outputs make the result match a sequential run when the operators are deterministic.
- **Performance refinements.** Locality-aware scheduling against GFS block locations, many small tasks for load balancing, backup executions of the last tasks to cut straggler delay, plus a user-defined partitioning function, ordering within a partition, a combiner, skipping of bad records, a local execution mode, status pages and counters.

## Methodology

The paper presents the model with the word count example and a list of other computations (distributed grep, URL access frequency, reverse web-link graph, term vector per host, inverted index, distributed sort), then describes the C++ implementation and the cluster environment it targets. The design discussion covers the master's data structures, failure cases for workers and for the master, the semantics when operators are non-deterministic, locality, task granularity and backup tasks.

The evaluation has two parts. First, two benchmark programs on a cluster of about 1800 machines (two 2GHz Xeon processors, 4GB of memory, two 160GB IDE disks and a gigabit Ethernet link each): a grep over 10^10 100-byte records, and a sort of 10^10 100-byte records modeled after TeraSort, run on a weekend afternoon when the cluster was mostly idle. The sort is also run with backup tasks disabled and with 200 workers killed on purpose. Second, usage statistics from Google's production environment, including a rewrite of the production indexing system.

## Findings

All figures below are from the paper.

- **Scale of the configuration.** The authors often run with M = 200,000 and R = 5,000 on 2,000 worker machines, choosing M so each task reads 16 MB to 64 MB of input. The master makes O(M + R) scheduling decisions and keeps O(M * R) state, about one byte per map/reduce pair.
- **Grep.** Scanning 10^10 records for a pattern found in 92,337 of them peaked above 30 GB/s with 1764 workers and took about 150 seconds, including about a minute of startup overhead.
- **Sort.** Sorting about 1 terabyte takes 891 seconds in the normal run, with a user program of fewer than 50 lines. The paper compares this with the best reported TeraSort result of 1057 seconds. The input rate peaks at about 13 GB/s, higher than shuffle and output, because most input is read from local disks.
- **Backup tasks.** Without them the sort takes 1283 seconds, 44% longer, because the last 5 reduce tasks finish 300 seconds after the others. The mechanism typically adds no more than a few percent of resources.
- **Machine failures.** Killing 200 of 1746 workers lets the sort finish in 933 seconds, a 5% increase. In another run, network maintenance made groups of 80 machines unreachable for minutes and the job still completed.
- **Adoption.** In August 2004 Google ran 29,423 jobs, averaging 634 seconds and 157 worker machines, reading 3,288 TB, producing 758 TB of intermediate data and writing 193 TB, using 79,186 machine-days. Programs checked into the source tree grew from none in early 2003 to almost 900 by late September 2004.
- **Indexing.** The production indexing system, over more than 20 terabytes of raw documents, became a sequence of five to ten MapReduce operations. One phase shrank from about 3800 lines of C++ to about 700.

## Critical Analysis

The paper is unusually candid and its core idea held up: a restricted model buys automatic parallelism and recovery. Several limits are visible in the text itself.

- **The master is a single point of failure.** The implementation aborts the job if the master dies, and the authors argue this is unlikely and that clients can retry.
- **Exactly-once effects are not provided.** Outputs are committed atomically through renames, but side effects from user code must be made atomic and idempotent by the application, and there is no multi-file two-phase commit. The authors say this restriction has never been an issue in practice, which is their own report.
- **The evaluation is narrow.** Two benchmarks on a nearly idle cluster, and a TeraSort comparison against a different system on different hardware that the paper itself calls only "similar".
- **Everything goes through disk.** Intermediate data is written to local disks and results to GFS, and chaining jobs means writing and re-reading files.

What later literature changed, which is not a claim of the PDF: systems such as Spark (resilient distributed datasets, NSDI 2012) keep working sets in memory and recover them from lineage, which suits iterative jobs; Dryad generalized the two-stage shape to arbitrary dataflow graphs; database researchers argued, for example in Pavlo et al. (2009), that parallel databases beat MapReduce on structured queries. The [Dataflow Model](/papers/dataflow-model-unbounded-out-of-order-data) later extended Google's own processing model to unbounded, out-of-order data, a case this batch design does not address. Open-source Hadoop made the model widely available outside Google.

## Further Research

- Reading the [Google File System](/papers/google-file-system) paper, which defines the storage layer and the locality assumptions MapReduce relies on.
- Dryad, Spark and the Dataflow Model, for in-memory, graph-shaped and streaming generalizations.
- Implementing a simplified MapReduce yourself: the first lab of MIT 6.5840 (Distributed Systems) does exactly this, with a coordinator, workers and failure recovery.
- Studies of stragglers and speculative execution, and of skew in the partitioning of keys.
- Provenance and debugging tools for large jobs, since the paper's own debugging aids are a local mode, status pages and counters.

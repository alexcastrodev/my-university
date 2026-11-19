---
title: "Bigtable: A Distributed Storage System for Structured Data"
summary: Chang and colleagues describe Bigtable, Google's sparse, sorted, multi-dimensional map built on GFS and Chubby, which splits tables into tablets served by many machines, gives atomicity only per row, and runs more than sixty Google products.
researchArea: Distributed Systems
keywords: bigtable, wide-column store, tablets, sstable, memtable, log-structured storage, single-row transactions, chubby, gfs
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Bigtable is a distributed storage system for managing structured data that is designed to scale to a very large size: petabytes of data across thousands of commodity servers. Many projects at Google store data in Bigtable, including web indexing, Google Earth, and Google Finance. These applications place very different demands on Bigtable, both in terms of data size (from URLs to web pages to satellite imagery) and latency requirements (from backend bulk processing to real-time data serving). Despite these varied demands, Bigtable has successfully provided a flexible, high-performance solution for all of these Google products. In this paper we describe the simple data model provided by Bigtable, which gives clients dynamic control over data layout and format, and we describe the design and implementation of Bigtable.

## Overview

By 2006 Google ran many products that each needed to store very large amounts of structured data, and a relational database was not the tool the authors chose. The paper sits on top of other Google infrastructure covered in this catalog: Bigtable keeps its logs and data files in the [Google File System](/papers/google-file-system), uses the [Chubby lock service](/papers/chubby-lock-service-loosely-coupled-distributed-systems) to elect its master and track its servers, and is used as input and output of [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) jobs. It appeared at OSDI 2006, in Seattle, the same meeting as the Chubby paper.

The paper describes a system that was already in production use since April 2005, after roughly seven person-years of design and implementation. The authors say Bigtable is used by more than sixty Google products and projects. It is deliberately not a full relational database: it offers a map from row, column and timestamp to an uninterpreted string, with no joins and no general transactions. The authors also argue that the key-value model of distributed hash tables and B-trees is too limiting. Amazon's [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), a key-value store with a different design, appeared a year later and is not discussed in this paper.

Worth knowing first: what a distributed file system like GFS guarantees, the idea of a lease or lock held through a lock service, and the difference between a write-ahead log and the data files it protects.

## Contribution

- **A data model between key-value and relational.** A table is a sparse, distributed, persistent, multi-dimensional sorted map, indexed by a row key, a column key (written family:qualifier) and a 64-bit timestamp. Rows are kept in lexicographic order, so clients choose row keys to get locality, for example by storing reversed hostnames.
- **Atomicity at the row.** Every read or write under one row key is atomic, whatever the number of columns. Bigtable supports single-row transactions but no general transactions across row keys.
- **Tablets as the unit of distribution.** A table's row range is split dynamically into tablets of about 100 to 200 MB by default, each assigned to one tablet server at a time. One master assigns tablets and balances load, but client data does not pass through it.
- **A three-level location scheme.** A Chubby file points to a root tablet, which points to METADATA tablets, which point to user tablets. With 128 MB METADATA tablets the paper computes that this addresses 2^34 tablets.
- **A log-structured tablet representation.** Writes go to a commit log and a memtable. Full memtables become immutable SSTables on GFS, and background merging and major compactions bound the number of files a read must consult.
- **Tuning knobs for clients.** Locality groups, per-group compression, in-memory groups, Bloom filters and two cache levels let users shape performance through the schema.

## Methodology

The paper is a system description plus measurements and production experience. Sections 2 to 5 cover the data model, the client API, the building blocks (GFS, the SSTable format and Chubby) and the implementation: tablet location, assignment, serving and compactions. Section 6 describes refinements, such as sorting the shared commit log to speed up recovery and using two log-writing threads to hide GFS latency spikes.

The evaluation is a set of micro-benchmarks. The authors ran a cluster with N tablet servers, each with 1 GB of memory, writing to a GFS cell of 1786 machines with two 400 GB IDE drives each, and an equal number of client machines, on machines with two dual-core 2 GHz Opteron chips and gigabit Ethernet. They read and wrote 1000-byte values with sequential and random writes, sequential and random reads, scans and random reads from memory, for N of 1, 50, 250 and 500. Section 8 then describes three real users (Google Analytics, Google Earth and Personalized Search), and Section 9 lists lessons.

## Findings

These are the results and observations reported by the authors.

- **Scale in production.** As of August 2006 there were 388 non-test clusters with about 24,500 tablet servers in total. One group of 14 busy clusters with 8069 tablet servers saw more than 1.2 million requests per second, with about 741 MB/s of incoming and 16 GB/s of outgoing RPC traffic.
- **Per-server throughput.** With one tablet server, random reads reached 1212 values per second, because each read fetches a 64 KB SSTable block from GFS to use 1000 bytes. Random reads from memory reached 10811, random writes 8850 and scans 15385. Writes are fast because all of them are appended to one commit log with group commit.
- **Scaling is real but not linear.** Aggregate throughput grows by over a factor of a hundred from 1 to 500 tablet servers, and random reads from memory by almost a factor of 300. Random reads scale worst, by about 100 for 500 times more servers, because the 64 KB transfers saturate shared gigabit links. Per-server rates fall: sequential writes go from 8547 to 1905 per second, which the authors attribute to load imbalance and other processes competing for CPU and network.
- **Compression.** A two-pass scheme on Webtable pages, with similar pages stored close together, achieved a 10-to-1 reduction in space, against 3-to-1 or 4-to-1 for typical Gzip on HTML.
- **Chubby dependence is measured.** Across 14 clusters and 11 Chubby instances, data was unavailable because of Chubby for 0.0047% of server hours on average and 0.0326% in the worst cluster.
- **Lessons.** Real failures go beyond fail-stop and partitions (corruption, clock skew, hung machines, bugs in Chubby), new features should wait until their use is clear, since most applications needed only single-row transactions, and simple designs matter. The first tablet-server membership protocol, based on master-issued leases, was too sensitive to network problems and master recovery time, and the redesigned one became too complex, so the authors replaced it with a simpler one that depends only on widely used Chubby features.

## Critical Analysis

The paper is candid about its limits, and the design choices are clear. It is also a snapshot of 2006, and several points are worth keeping in mind.

- **No cross-row atomicity.** The authors say they have no general transactions, and that the most important use of the distributed transactions that users requested is maintaining secondary indices, for which they plan a specialized mechanism. Applications that need multi-row invariants must build them on the client side.
- **Availability depends on one service.** If Chubby is unavailable for an extended period, Bigtable is unavailable. The measurement is reassuring but comes from one operator's own clusters.
- **The evaluation is narrow.** The benchmarks are micro-benchmarks on one network in one facility, with no latency distributions, no failure-injection experiments, and no comparison with another system.
- **Replication is only sketched.** The paper mentions client-side and server-side replication for Personalized Search and says cross-datacenter replication with multiple masters is being built, but does not describe a consistency model across clusters.

The next points come from later literature, not from the PDF. The [Spanner](/papers/spanner-globally-distributed-database) paper, published in 2012, says Bigtable was hard to use for applications with evolving schemas or that needed strong consistency across wide-area replicas, and presents a system with semi-relational tables and distributed transactions. Megastore (Baker et al., CIDR 2011), built on top of Bigtable, added ACID transactions within partitions and synchronous replication across datacenters. The authors also published a longer version, in ACM Transactions on Computer Systems in 2008, which is a separate record. Open systems such as Apache HBase and Cassandra adopted Bigtable's data model, and the memtable and SSTable structure became a common storage-engine design. The paper itself relates it to the log-structured merge tree.

A reader can also notice that the guarantee of atomic row operations is stated informally here: how it relates to the formal condition in [Linearizability](/papers/linearizability-correctness-condition-concurrent-objects) is a reading, not something the paper establishes.

## Further Research

- General and efficient multi-row transactions on top of a sorted, partitioned store, and secondary indices that stay consistent with the base data.
- Strongly consistent replication across datacenters for a Bigtable-style data model, as pursued by Megastore and Spanner.
- Lessons for multi-tenant service operation: the paper already adds a quota mechanism for shared tables and expects more resource-sharing issues as service clusters scale.
- Storage-engine work on the cost of compaction and read amplification in log-structured designs, and how Bloom filters and caches trade memory for disk reads.
- Failure handling beyond fail-stop assumptions, including corruption and clock skew, which the lessons section notes are not covered by the fail-stop assumptions of many distributed protocols.

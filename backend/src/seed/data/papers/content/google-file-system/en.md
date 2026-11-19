---
title: "The Google File System"
summary: Ghemawat, Gobioff and Leung describe GFS, Google's scalable file system for huge, append-mostly files on commodity hardware, built around one master for metadata, chunkservers for data, relaxed consistency and failure treated as the norm.
researchArea: Distributed Systems
keywords: distributed file system, chunkservers, single master, record append, relaxed consistency, fault tolerance, replication, leases
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

We have designed and implemented the Google File System, a scalable distributed file system for large distributed data-intensive applications. It provides fault tolerance while running on inexpensive commodity hardware, and it delivers high aggregate performance to a large number of clients. While sharing many of the same goals as previous distributed file systems, our design has been driven by observations of our application workloads and technological environment, both current and anticipated, that reflect a marked departure from some earlier file system assumptions. This has led us to reexamine traditional choices and explore radically different design points. The file system has successfully met our storage needs. It is widely deployed within Google as the storage platform for the generation and processing of data used by our service as well as research and development efforts that require large data sets. The largest cluster to date provides hundreds of terabytes of storage across thousands of disks on over a thousand machines, and it is concurrently accessed by hundreds of clients. In this paper, we present file system interface extensions designed to support distributed applications, discuss many aspects of our design, and report measurements from both micro-benchmarks and real world use.

## Overview

By 2003 Google stored the data behind its web services on clusters of cheap Linux machines, where disks, memory, networks and power supplies failed all the time. The authors argue that the classic file system assumptions (small files, random writes, POSIX semantics, strong consistency) did not fit that setting, and they chose to co-design the file system and its applications instead. The result was the system that later storage designs are usually compared against.

The paper is an engineering report from a production system. It does not use the word Paxos and does not run a consensus protocol among its servers: one master holds all metadata, and replicas of a chunk are kept in order by a lease-holding primary. The other Google systems in this catalog sit around it. The [Chubby lock service](/papers/chubby-lock-service-loosely-coupled-distributed-systems) is described by its own paper as the place where GFS and Bigtable elect their masters, and [Spanner](/papers/spanner-globally-distributed-database) places its tablets on Colossus, which its authors call the successor to GFS.

Worth knowing first: the ordinary file system interface (create, read, write, append), replication for fault tolerance, and the idea of a lease (a promise to act as leader that expires). Compare the replication here with the consensus-based approach of [Paxos Made Simple](/papers/paxos-made-simple), the [state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial) and the strict model of [linearizability](/papers/linearizability-correctness-condition-concurrent-objects).

## Contribution

- **Four workload observations as design inputs.** Component failures are the norm, files are huge (multi-GB is common), most files are mutated by appending rather than overwriting, and co-designing applications and file system API adds flexibility.
- **Architecture with one master.** A cluster has a single master and many chunkservers. Files are split into fixed-size 64 MB chunks, each with a 64 bit chunk handle and three replicas by default. The master keeps the namespace, the file-to-chunk mapping and chunk locations; clients ask it where data is and then talk to chunkservers directly.
- **Metadata in memory with a replicated log.** Namespaces and the file-to-chunk mapping are logged to an operation log replicated on remote machines, with checkpoints. Chunk locations are not persisted: the master learns them by polling chunkservers.
- **A relaxed consistency model.** Regions after a mutation are consistent, defined or neither, and applications cope by appending, checkpointing and writing self-validating, self-identifying records.
- **Record append.** Clients give only the data, and GFS appends it atomically at least once at an offset of its choosing, so hundreds of producers can write one file without a distributed lock manager.
- **Leases, pipelined data flow and cheap snapshots.** A primary replica orders mutations under a lease from the master, data is pushed along a chain of chunkservers separately from control messages, and snapshots use copy-on-write.

## Methodology

The paper combines a design description with measurements. Sections 2 to 5 explain the interface, the architecture and the mechanisms for mutations, master operation (namespace locking, replica placement, re-replication, rebalancing, lazy garbage collection, stale replica detection) and fault tolerance (fast recovery, chunk and master replication, shadow masters, checksums, diagnostic logs).

Section 6 reports micro-benchmarks on a cluster of one master, two master replicas, 16 chunkservers and 16 clients, each machine with dual 1.4 GHz Pentium III processors, 2 GB of memory and a 100 Mbps Ethernet link, then numbers from two production clusters (A for research and development, B for production data processing). It also analyses two other clusters (X and Y) from heuristically reconstructed RPC logs. Section 7 lists operational experiences, and Section 8 compares GFS with AFS, xFS, Swift, Frangipani, GPFS, Lustre, NASD and River.

## Findings

- **Reads.** One client reads at 10 MB/s, 80% of its 12.5 MB/s link limit. With 16 readers the aggregate is 94 MB/s, about 75% of the 125 MB/s limit.
- **Writes.** One client writes at 6.3 MB/s, about half of the limit. The aggregate reaches 35 MB/s for 16 clients (2.2 MB/s each), against a 67 MB/s limit. The authors blame their network stack's interaction with the pipelining scheme.
- **Record appends.** They start at 6.0 MB/s for one client and drop to 4.8 MB/s for 16 clients, limited by the chunkservers holding the last chunk.
- **Production clusters.** Cluster A has 342 chunkservers, 72 TB of disk of which 55 TB is used, and about 48 MB of master metadata. Cluster B has 227 chunkservers, 180 TB and 155 TB, with 60 MB at the master. Cluster A had sustained a read rate of 580 MB/s for a week, and the master saw 200 to 500 operations per second, so it was not a bottleneck there.
- **Recovery.** Killing one chunkserver with about 15,000 chunks and 600 GB restored every chunk in 23.2 minutes (440 MB/s). Killing two chunkservers left 266 chunks with one replica, all back to at least two replicas within 2 minutes.
- **Workload.** Overwrites were under 0.0001% of bytes mutated in cluster X and 0.05% in cluster Y, mostly from client retries. The ratio of writes to record appends was 108:1 by bytes in X and 3.7:1 in Y.
- **Operational surprises.** IDE disks that mismatched the protocol version corrupted data silently, which motivated checksums. The cost of fsync() on Linux 2.2 and a single mmap lock led to workarounds such as replacing mmap() with pread().

## Critical Analysis

The paper is candid about its context: "Google completely controls both GFS and its applications", so the design is tuned to one workload and the authors warn against generalizing. Some limits are worth keeping in mind.

- **Consistency is weak by design.** Concurrent writes leave "consistent but undefined" regions, record append can duplicate records, and replicas need not be byte-identical. This pushes work (checksums, unique record ids, checkpoints) onto every application.
- **The single master is a stated trade-off.** The authors choose simplicity and global placement knowledge, and keep the master off the data path with big chunks, cached locations and leases. Their own measurements show it was not a bottleneck at 200 to 500 operations per second, and an earlier version had been one on large directory scans.
- **Failover is not automatic inside GFS.** A failed master is restarted by monitoring infrastructure outside GFS, and shadow masters give only read access with slightly stale metadata. The paper suggests adapting a primary-copy scheme like Harp for stronger guarantees but does not do it.
- **Limited evaluation.** The micro-benchmarks use a small 16-machine cluster on 100 Mbps links and the workload numbers come from reconstructed logs.

What later work added (this is not in the PDF). In the ACM Queue interview "GFS: Evolution on Fast-Forward" (McKusick and Quinlan, 2009, reprinted in CACM 2010), Quinlan says the single master was chosen to simplify the design, and that it became a scaling problem as storage and the number of operations grew. The Spanner paper cited above says GFS was succeeded by Colossus. Treat the specifics of how Colossus spreads metadata as outside this paper.

## Further Research

- Spreading metadata across several masters or a partitioned namespace, instead of a single master.
- Erasure codes and parity instead of three-way replication, which the authors already mention as a direction for read-mostly data.
- Stronger consistency or primary-copy failover for the master, as the authors suggest with Harp.
- Atomic append and consistency semantics in object stores and shared logs, and file systems that keep POSIX compatibility.
- Studies of how silent disk and kernel corruption affects storage systems at scale.

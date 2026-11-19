---
title: "Ceph: A Scalable, High-Performance Distributed File System"
summary: Ceph removes allocation tables from a petabyte-scale file system by computing where objects live with a pseudo-random function (CRUSH), lets semi-autonomous storage devices handle replication and recovery, and spreads the namespace over a cluster of metadata servers that rebalances by subtree.
researchArea: Distributed Systems
keywords: ceph, crush, rados, object storage, placement groups, dynamic subtree partitioning, metadata server, posix
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

We have developed Ceph, a distributed file system that provides excellent performance, reliability, and scalability. Ceph maximizes the separation between data and metadata management by replacing allocation tables with a pseudo-random data distribution function (CRUSH) designed for heterogeneous and dynamic clusters of unreliable object storage devices (OSDs). We leverage device intelligence by distributing data replication, failure detection and recovery to semi-autonomous OSDs running a specialized local object file system. A dynamic distributed metadata cluster provides extremely efficient metadata management and seamlessly adapts to a wide range of general purpose and scientific computing file system workloads. Performance measurements under a variety of workloads show that Ceph has excellent I/O performance and scalable metadata management, supporting more than 250,000 metadata operations per second.

## Overview

By 2006, NFS-style servers had hit a scaling wall, and object-based file systems (Lustre, Panasas and others) had moved block allocation into the storage devices but still kept a list of objects per file and, in the paper's account, distributed the metadata workload little or not at all. This OSDI 2006 paper, by Sage Weil and colleagues at UC Santa Cruz, targets scientific and HPC workloads, such as tens of thousands of hosts writing to one file or creating files in one directory, which the authors expect to indicate tomorrow's general-purpose workloads. The paper assumes petabyte-scale systems are always changing: built incrementally, with failures as the norm.

Ceph has three parts: a client exposing a near-POSIX interface, a cluster of OSDs that stores all data and metadata, and an MDS cluster that manages the namespace. For readers of this catalog, the closest neighbor is the [Google File System](/papers/google-file-system), which the paper cites as optimized for large files with reads and appends and "non-POSIX semantics". The paper does not cite [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) or [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store); the comparisons below are mine. Like [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) and Dynamo, CRUSH computes placement instead of looking it up, but it adds failure domains and weights. Chubby is the nearest comparison for Ceph's monitors, a small group that keeps the cluster map consistent with elections, leases and two-phase commits.

Worth knowing first: inodes and directory entries, striping, primary-copy replication, and what POSIX requires of reads and writes.

## Contribution

- **Data and metadata decoupled by a function.** File data is striped over objects named from the inode number and stripe number. Objects map to placement groups (PGs) by a hash, and CRUSH maps each PG to an ordered list of OSDs using only the PG and a compact cluster map. Any client, OSD or MDS can compute the location, so no allocation list exists.
- **Autonomous OSDs (RADOS).** OSDs run primary-copy replication, mutual failure detection, peering and parallel re-replication, and keep objects in EBOFS, a user-space extent and B-tree object file system.
- **Dynamic subtree partitioning.** Each MDS tracks the popularity of metadata with decaying counters and migrates subtrees to balance load. Hot directories are replicated or hashed across nodes only when needed.
- **Near-POSIX semantics with HPC extensions.** Capabilities and synchronous I/O keep POSIX behavior for shared files. `O_LAZY`, `lazyio_propagate`, `lazyio_synchronize`, `readdirplus` and `statlite` let applications relax it.
- **Prototype and evaluation.** A working user-space prototype measured on up to a 430-node cluster.

## Methodology

Clients, OSDs and MDSs are user processes on a dual-processor Linux cluster with SCSI disks over TCP, usually one OSD or MDS per host. Four things are measured: per-OSD throughput on a 14-node OSD cluster (400 clients on 20 more nodes), write latency for a single writer, data distribution and scaling with CRUSH, hash and linear placement, and metadata performance. Metadata tests run with no data I/O, OSDs used only to store metadata. Scaling runs used a 430-node partition of the alc cluster at LLNL (two days of dedicated access). Workloads: makedirs, makefiles, openshared and two replays of an OpenSSH compile trace (openssh+lib, openssh+include).

## Findings

These are the authors' reported results.

- **EBOFS.** Disk bandwidth is around 58 MB/s. EBOFS nearly saturates it for writes larger than 32 KB and beats ext3, ReiserFS and XFS on reads. Small writes suffer from coarse locking, and it was only tested on a fresh file system.
- **Write latency.** A 1 MB synchronous write takes 13 ms with one replica and 33 ms with three. Small writes cost little extra beyond two replicas, because the primary forwards to replicas in parallel. Clients mask latency above 128 KB by taking object locks and flushing asynchronously.
- **Distribution.** With 100 PGs per OSD the standard deviation of OSD utilization is 10%, with 1000 it is 3%. Write throughput scales linearly with OSDs until the switch saturates at 24 OSDs. CRUSH is O(log n) and takes tens of microseconds.
- **Metadata path.** A readdir fetches the whole directory with embedded inodes in one MDS request, so later stats are cheap, and `readdirplus` removes them.
- **Metadata scaling.** In makedirs, per-MDS throughput falls from 2000 ops/s with a small cluster to about 1000 ops/s (50% efficiency) with 128 MDSs, over 100,000 ops/s in total. For most workloads efficiency at 128 nodes is no worse than 50% below linear. openshared and openssh+include scale worst, which the authors attribute to poor replica selection by clients.
- **The 250,000 figure.** It comes from 128 nodes at 2000 ops/s, not from a measurement at that scale.
- **Back-of-the-envelope.** A BlueGene/L checkpoint of 64 thousand nodes writing to one directory, which takes minutes on a system peaking at 6,000 metadata ops/s, could finish in two seconds.

## Critical Analysis

The paper is open about gaps: MDS failure recovery is not implemented, monitors are only partly implemented, the prototype trusts all clients, and some POSIX calls are missing.

- **Reliability is designed, not measured.** Section 6 has no experiment on OSD failure, recovery time or re-replication. The failure-detection design (down versus out, monitors) is described only in prose.
- **The headline number is an extrapolation.** The abstract says more than 250,000 operations per second. The measured 128-node makedirs total is over 100,000, and the authors suspect network or messaging-layer contention but had no time to investigate.
- **Limited baselines.** The only comparisons are EBOFS against local file systems and CRUSH against hash and linear placement. There is no run against Lustre, GFS or any other distributed file system. Figure 11's legend lists 128 MDSs while the text says a 64-node cluster.
- **Workloads.** The metadata benchmarks are synthetic or one replayed compile trace, and the MDS load balancer is described in the Experiences section as one of the largest lessons of the project.

Later literature, marked as such: the SOSP 2019 paper by Aghayev, Weil and others (I read its abstract, introduction and background sections, not the whole paper) reports that EBOFS was replaced in 2008 by FileStore over Btrfs, later XFS, and that BlueStore, started in 2015, became the default production backend in 2017. Its authors say a 2018 survey found 70% of users running BlueStore in production, and describe the Ceph stack as RADOS with RGW, RBD and CephFS on top.

## Further Research

- Failure behavior at scale: recovery time and data-loss probability under correlated failures, which the paper's design targets but does not measure.
- MDS failure recovery from the journal, snapshots of arbitrary subtrees, and callbacks for static regions so that read opens need no MDS call.
- Dynamic replication of hot objects and read distribution across replicas, which the authors list as planned.
- Quality of service between client I/O and recovery traffic, and data checksums.
- A fair comparison of subtree partitioning against hashing under the same MDS cluster and workload.

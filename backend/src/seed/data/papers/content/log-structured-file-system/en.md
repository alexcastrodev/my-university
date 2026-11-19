---
title: "The Design and Implementation of a Log-Structured File System"
summary: Rosenblum and Ousterhout write every file system change to disk sequentially in a log, split into segments that a cleaner keeps free, and show with simulations and the Sprite LFS prototype that a cost-benefit cleaning policy lets it write small files about ten times faster than SunOS while keeping cleaning overhead low in production.
researchArea: Operating Systems
keywords: log-structured file system, segment cleaning, write cost, cost-benefit policy, checkpoint, roll-forward, inode map, Sprite LFS
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This paper presents a new technique for disk storage management called a log-structured file system. A log-structured file system writes all modifications to disk sequentially in a log-like structure, thereby speeding up both file writing and crash recovery. The log is the only structure on disk; it contains indexing information so that files can be read back from the log efficiently. In order to maintain large free areas on disk for fast writing, we divide the log into segments and use a segment cleaner to compress the live information from heavily fragmented segments. We present a series of simulations that demonstrate the efficiency of a simple cleaning policy based on cost and benefit. We have implemented a prototype log-structured file system called Sprite LFS; it outperforms current Unix file systems by an order of magnitude for small-file writes while matching or exceeding Unix performance for reads and large writes. Even when the overhead for cleaning is included, Sprite LFS can use 70% of the disk bandwidth for writing, whereas Unix file systems typically can use only 5 to 10%.

## Overview

This is the full journal version (ACM Transactions on Computer Systems, February 1992) of work first presented at SOSP '91 by Mendel Rosenblum and John Ousterhout, then at Stanford and Berkeley. The baseline it argues against is the Berkeley Unix fast file system (FFS), which keeps the inode design of [The UNIX Time-Sharing System](/papers/unix-time-sharing-system) but lays blocks out carefully on disk. The paper's bet is about hardware trends in 1991: CPUs and memories keep getting faster, disk access time does not, so caches absorb reads and disk traffic becomes mostly writes. Its answer is also an instance of the hint to "log updates" in [Hints for Computer System Design](/papers/hints-for-computer-system-design), taken to the extreme of making the log the only copy of the data.

The catalog pairings in this paragraph are mine, not the paper's. Sprite LFS keeps its data in a sequential log with a cleaner, an idea that returns in [Bigtable](/papers/bigtable-distributed-storage-system-structured-data) (commit log, memtable and immutable SSTable files, merged in the background) and, with a different goal, in the shared log of [CORFU](/papers/corfu-shared-log-design-for-flash-clusters) for flash clusters. The metadata log with checkpoints in [The Google File System](/papers/google-file-system) is a smaller cousin: there the log protects metadata, while in LFS it holds everything.

Worth knowing first: what an inode and an indirect block are, why a seek costs far more than sequential transfer on a disk, what fsck does after a crash, and the difference between write-ahead logging in a database and using the log as the final home of the data.

## Contribution

- **The log is the file system.** File data, inodes, indirect blocks, directories and the other structures are buffered in the file cache and written to disk in one large sequential write. There is no bitmap or free list, and no other copy on disk. The paper contrasts this with systems that use a log only as temporary storage.
- **Inode map.** Inodes are no longer at fixed addresses, so an inode map gives the current log address of each inode. Its blocks are also written to the log, are small enough to be cached in memory, and are located from a fixed checkpoint region.
- **Segments plus cleaning.** The disk is divided into fixed-size segments (512 KB or 1 MB in Sprite LFS). Free space is managed by a mix of threading and copying: the log is threaded segment by segment, and a cleaner copies live blocks out of fragmented segments so they can be rewritten. Segment summary blocks and a per-file version number let the cleaner tell live blocks from dead ones.
- **Write cost and the cost-benefit policy.** The paper defines write cost, the disk time per byte of new data including cleaning, and gives write cost = 2 / (1 - u) for cleaned segments of utilization u. It proposes choosing segments by (1 - u) * age / (1 + u) and sorting live blocks by age, so cold segments are cleaned at higher utilization than hot ones.
- **Checkpoints and roll-forward.** Two alternating checkpoint regions mark consistent states. Roll-forward then scans the log written after the last checkpoint, and a directory operation log keeps directory entries and inode reference counts consistent.

## Methodology

The design part is argued from technology and workload trends, with the Berkeley FFS as the running comparison. The cleaning policies are studied with a simulator: a fixed number of 4 KB files, overwritten one at a time under a uniform pattern or a hot-and-cold pattern (10% of files get 90% of writes), with constant disk utilization and no read traffic. The authors state that this model is harsher than reality.

The evaluation has three parts. Micro-benchmarks compare Sprite LFS with SunOS 4.0.3 (an FFS-based system) on one Sun-4/260 with 32 MB of memory and a Wren IV disk (1.3 MB/s maximum transfer, 17.5 ms average seek), around 300 MB of usable storage per file system, 8 KB blocks for SunOS and 4 KB blocks with 1 MB segments for Sprite LFS. No cleaning happened during these runs, so they are best-case. Second, cleaning statistics were gathered over four months on five production Sprite file systems (/user6, /pcs, /src/kernel, /tmp, /swap2), after waiting several months to remove start-up effects. Third, crash recovery was timed with a special build and the modified Andrew benchmark was run for a realistic workload.

## Findings

- **Small files.** On a benchmark that creates, reads and deletes 10000 files of 1 KB, Sprite LFS is almost ten times as fast as SunOS for create and delete, and also faster for reads. During creation it kept the disk 17% busy while saturating the CPU, while SunOS kept the disk 85% busy while using about 1.2% of the disk's potential bandwidth for new data. The authors predict Sprite LFS would gain another factor of 4 to 6 on faster CPUs, and SunOS almost nothing.
- **Large files.** On a 100 MB file Sprite LFS has higher write bandwidth than SunOS in all cases and similar read bandwidth, except for reading sequentially a file that was written randomly, where it is substantially slower because of seeks. The paper adds that a newer SunOS that groups writes should match Sprite LFS on sequential writes.
- **Simulation.** At 75% overall utilization with uniform access, the cleaned segments average only 55% utilization. With a greedy cleaner, more locality made things worse, because cold segments linger just above the cleaning point and tie up free space. The cost-benefit policy produced the hoped-for bimodal distribution, cleaning cold segments at about 75% utilization and hot ones at about 15%, and cut the write cost by as much as 50% against greedy.
- **Production cleaning.** Over four months the file systems ran at 11 to 75% disk utilization, more than half of the segments cleaned were empty, and overall write costs were 1.2 to 1.6, against 2.5 to 3 in the simulations. The paper reads this as about 70% of the maximum sequential write bandwidth, and Unix FFS on small files at 5 to 10%.
- **Recovery.** Recovery time depends on the number of files rolled forward: 1 MB of 1 KB files took 1 second, 50 MB of 1 KB files took 132 seconds, 50 MB of 100 KB files took 8 seconds. An hour-long checkpoint interval would give average recovery around one second for the observed write rates. The authors note that fsck-style scans in traditional file systems already take tens of minutes.
- **Everyday use and cost.** The modified Andrew benchmark ran only 20% faster than SunOS, because it is CPU-bound. Metadata blocks (inodes, inode map, segment usage table) were about 13% of the data written to the log, with the inode map alone above 7%.

## Critical Analysis

What the paper does not claim matters as much as what it does. The 1992 numbers have limits that the authors themselves state.

- **Roll-forward was not in production.** The production disks used a 30-second checkpoint interval and discarded everything after the last checkpoint on reboot. The recovery timings come from a special build, and the authors call the 30-second interval probably much too short.
- **The best case is the headline.** The order-of-magnitude result is for creating and deleting small files with no cleaning. The micro-benchmarks were run on one machine with one disk, and the paper admits the real-use gain (20% on Andrew) was modest.
- **Cleaning was only partly explored.** The authors did not study when to clean or how many segments to clean at a time, and they hope idle-time cleaning will help without knowing yet. The production workloads (about thirty users in a research group) are not transaction processing.
- **Baseline.** The paper itself notes that a newer SunOS groups writes and should match Sprite LFS on sequential writes, so SunOS 4.0.3 is a weaker baseline than later FFS versions.

The next points come from later literature, not from this PDF. Seltzer and colleagues (USENIX 1995, "File System Logging versus Clustering") compared the 4.4BSD log-structured file system, a different implementation from Sprite LFS, with the 4.4BSD FFS and reported that, ignoring cleaning, the order-of-magnitude gain applies only to metadata-intensive work (creating files of 1 KB or less and deleting files of 64 KB or less), that large-file performance is comparable, and that cleaner overhead cut transaction processing performance by more than 33% at a half-full disk. F2FS (Lee and colleagues, FAST '15) keeps the log and the checkpoint but replaces the inode map with a node address table to avoid the "wandering tree" update chain, writes several logs to separate hot and cold data, uses greedy cleaning in the foreground and cost-benefit in the background, and switches to threaded logging when space is tight. Btrfs (Rodeh, Bacik and Mason, ACM Transactions on Storage, 2013) is copy-on-write with B-trees and snapshots, a related but different way to avoid overwriting in place.

## Further Research

- Cleaning policies that predict data lifetime better than age, and when to run the cleaner in the background.
- Flash-aware log-structured designs, where the erase-before-write limit makes sequential writes and hot/cold separation valuable (F2FS is one example).
- Copy-on-write file systems that keep snapshots and avoid the update chain from leaf blocks to the root.
- Careful comparisons between logging and clustering file systems across aged disks and transaction workloads.
- Per-block modification times, which the authors planned, and the effect of checkpoint intervals on recovery time and metadata overhead.

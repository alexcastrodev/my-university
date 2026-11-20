---
title: "A Fast File System for UNIX"
summary: McKusick, Joy, Leffler and Fabry reimplement the UNIX file system for the VAX with 4096 or 8192 byte blocks split into fragments, cylinder groups and rotation-aware allocation. On a VAX 11/750 it reads and writes at up to 47% of the disk bandwidth, against 3 to 5% for the old file system, and it adds long names, advisory locks, symbolic links, rename and quotas.
researchArea: Operating Systems
keywords: fast file system, FFS, cylinder groups, block fragments, disk layout, allocation policy, rotational layout, 4.2BSD
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

A reimplementation of the UNIX file system is described. The reimplementation provides substantially higher throughput rates by using more flexible allocation policies that allow better locality of reference and can be adapted to a wide range of peripheral and processor characteristics. The new file system clusters data that is sequentially accessed and provides two block sizes to allow fast access to large files while not wasting large amounts of space for small files. File access rates of up to ten times faster than the traditional UNIX file system are experienced. Long needed enhancements to the programmers' interface are discussed. These include a mechanism to place advisory locks on files, extensions of the name space across file systems, the ability to use long file names, and provisions for administrative control of resource usage.

## Overview

This is the Berkeley file system released with 4.2BSD, later called FFS, published in ACM Transactions on Computer Systems in August 1984 (volume 2, number 3, pages 181-197). The text I read is the open Berkeley copy, the Computer Systems Research Group report revised February 18, 1984 (14 pages), not the journal typesetting, so wording may differ slightly from the printed version. It starts from the file system of [The UNIX Time-Sharing System](/papers/unix-time-sharing-system): a super-block, inodes, direct and indirect blocks, and a linked free list, designed for the PDP-11 with 512 byte blocks.

The problem is throughput on the VAX-11, where applications such as VLSI design and image processing, and paging into large virtual address spaces, need bandwidth. The paper says the 512 byte file system gives about two percent of the maximum disk bandwidth, or about 20 kilobytes per second per arm. It keeps the interface and changes the implementation, so users face no massive software conversion.

The catalog pairings are mine, not the paper's. [The Design and Implementation of a Log-Structured File System](/papers/log-structured-file-system) later takes this design as its baseline. [All File Systems Are Not Created Equal](/papers/all-file-systems-are-not-created-equal-crash-consistent-applications) and [Using Crash Hoare Logic for Certifying the FSCQ File System](/papers/using-crash-hoare-logic-for-certifying-the-fscq-file-system) study the crash behavior that this paper leaves aside.

Worth knowing first: what an inode and an indirect block are, what a cylinder and a track are on a rotating disk, and why a seek costs much more than a transfer.

## Contribution

- **Why the old system was slow.** The first Berkeley change, from 512 to 1024 bytes, more than doubled performance, but the old file system still used about four percent of the bandwidth. The free list started ordered, then became random as files came and went: 175 KB/s when new, 30 KB/s after a few weeks of moderate use. Inodes sat apart from data (4 MB of inodes and 146 MB of data in a 150 MB file system), so reaching a file meant a long seek.
- **Bigger blocks with fragments.** Blocks are any power of two from 4096 up, recorded in the super-block. A block can be split into 2, 4 or 8 addressable fragments, no smaller than the disk sector (typically 512 bytes). Only the tail of a file uses fragments. The minimum of 4096 is what lets a file of 2 to the 32nd bytes need only two levels of indirection.
- **Cylinder groups.** The partition is divided into groups of consecutive cylinders, each with a copy of the super-block, its inodes (by default one per 2048 bytes), a bitmap of free blocks that replaces the free list, and usage summaries. The copies are offset by about one track per group, so losing one platter does not lose every copy.
- **Placement policy.** Inodes of the files of a directory go in the same group. A new directory goes in a group with above-average free inodes and the fewest directories. Data blocks of a file stay in the same group, but allocation moves to another group at 48 KB and at every megabyte after, picking a group with above-average free blocks.
- **Allocation by rotation.** Each file system is parameterized with processor and disk characteristics. The allocator skips blocks so that the next block of a file arrives under the head when a new transfer can start. The local allocator tries the rotationally closest block on the cylinder, then the group, then a quadratic hash to another group, then an exhaustive search. A free space reserve (10% in the tests) keeps the policies working.

## Methodology

The measurements come from one system. The test programs read or write a file without processing it, with enough data to defeat buffering, and run at least three times. Systems ran multi-user but quiescent, with no contention for CPU or disk arm. Every run used a VAX 11/750 and an AMPEX Capricorn 330 megabyte disk, on a UNIBUS or a MASSBUS controller. All file systems had been in production for at least a month, with a 10% free space reserve. Bandwidth is the achieved rate over an upper bound computed from bytes per track times revolutions per second (983 KB/s). Space waste was measured on a time-sharing system with about 1.2 GB of storage, over about 920 MB of active user file systems. The tests are described in a Berkeley technical report that I did not read.

## Findings

- **Inode access.** Listing a large directory of directories cut disk accesses for inodes by a factor of two. For large directories holding only files, the cut was a factor of eight.
- **Reads (Table 2a).** Old 1024: 29 KB/s (3% of bandwidth, 11% CPU). New 4096/1024: 221 KB/s on UNIBUS (22%) and 466 on MASSBUS (47%). New 8192/1024: 233 on UNIBUS (24%) and 466 on MASSBUS (47%).
- **Writes (Table 2b).** Old 1024: 48 KB/s (5%, 29% CPU). New 4096/1024: 142 on UNIBUS (14%) and 323 on MASSBUS (33%, 94% CPU). New 8192/1024: 215 on UNIBUS (22%) and 466 on MASSBUS (47%, 95% CPU). By my division the best cases are about 16 times faster for reads and 9.7 times for writes, while the abstract says up to ten times.
- **Why.** The paper credits mostly the larger block. Writes are slower than reads in the 4096 case because the kernel does twice as many allocations and the processor cannot keep up. Copying between kernel and user buffers takes about 40% of the time of an I/O operation. The new rates do not decay with time, but fall to about half when the file system is full.
- **Space (Table 1).** On the measured data, files take 775.2 MB with no separation, and the total with inodes is 828.7 MB (6.9% waste) for 512 byte blocks, 866.5 MB (11.8%) for 1024, 948.5 MB (22.4%) for 2048 and 1128.3 MB (45.6%) for 4096 without fragments. With fragments, the waste of 4096/1024 is about that of the old 1024 file system, and 4096/512 about that of the 512 file system, plus the reserve.
- **New facilities.** File names up to 255 characters in 512 byte directory chunks. Advisory shared and exclusive locks on open files, whole-file granularity, with almost no deadlock detection. Symbolic links across file systems. A rename call that guarantees the target name exists, with a loop check for directories. Quotas on inodes and blocks per user per file system, with soft and hard limits.

## Critical Analysis

The paper itself does not claim, and I did not find in it:

- **Crash consistency.** It mentions fsck only in its history of the old system (Kowalski's program, in a reference) and describes no recovery procedure for the new one. The only protection it adds is the replicated super-block. The rename call removes one crash window, and lock files are no longer left after a crash.
- **Portability of the tuning.** The allocator relies on disk geometry (blocks per track, rotation speed, interrupt service time) known to the operating system. The paper's setting is 1984 disks with 3600 rpm. My own comment: disks today hide their geometry, so the rotational part does not carry over, while the group and clustering ideas remain.
- **One machine.** All measurements are on a VAX 11/750 and one disk model, with one test program at a time and throughput as the metric. They say nothing about many concurrent processes. The paper lists block chaining and preallocation as not done.
- **Cost to adopt.** All existing file systems had to be dumped and restored, which is why the interface changes were bundled in.

Later literature, separate from the paper and checked only partly. Ganger and Patt (OSDI 1994, abstract on the USENIX page only) compare metadata update schemes and report that soft updates beat synchronous writes by more than a factor of two on metadata-heavy benchmarks. McKusick and Ganger (USENIX 1999; I read the abstract and introduction) say that BSD FFS used synchronous writes to order metadata and that soft updates allow it to run without fsck after a crash, with a background task reclaiming lost blocks.

## Further Research

- Crash recovery for a clustered, update-in-place layout without a full scan.
- Allocation when the operating system cannot see the disk geometry, as with flash and virtualized storage.
- Reducing the kernel copy (the paper puts it at about 40%) and block chaining in drivers.
- Preallocation when a file grows quickly, as in the DEMOS file system.
- Byte-range locks (the paper cites the Onyx file system) and symbolic links that span machines, which it describes as possible in future distributions.

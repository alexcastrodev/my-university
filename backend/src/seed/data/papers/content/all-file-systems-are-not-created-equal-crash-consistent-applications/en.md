---
title: "All File Systems Are Not Created Equal: On the Complexity of Crafting Crash-Consistent Applications"
summary: Pillai and colleagues show that databases, key-value stores, version control systems and distributed systems depend on persistence properties of the file system that POSIX does not promise. Their tools BoB and ALICE test sixteen file-system configurations and eleven applications, and find 60 crash vulnerabilities.
researchArea: Operating Systems
keywords: crash consistency, persistence properties, file systems, fsync, atomicity, ordering, crash vulnerabilities, write-ahead logging, ALICE, BoB
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

We present the first comprehensive study of application-level crash-consistency protocols built atop modern file systems. We find that applications use complex update protocols to persist state, and that the correctness of these protocols is highly dependent on subtle behaviors of the underlying file system, which we term persistence properties. We develop a tool named BoB that empirically tests persistence properties, and use it to demonstrate that these properties vary widely among six popular Linux file systems. We build a framework named ALICE that analyzes application update protocols and finds crash vulnerabilities, i.e., update protocol code that requires specific persistence properties to hold for correctness. Using ALICE, we analyze eleven widely-used systems (including databases, key-value stores, version control systems, distributed systems, and virtualization software) and find a total of 60 vulnerabilities, many of which lead to severe consequences. We also show that ALICE can be used to evaluate the effect of new file-system designs on application-level consistency.

## Overview

The paper appeared at OSDI '14 (Broomfield, October 2014) and comes from the Arpaci-Dusseau group at the University of Wisconsin-Madison. Its starting point is a gap between two layers. POSIX, the interface descended from [The UNIX Time-Sharing System](/papers/unix-time-sharing-system), specifies what a system call does in memory, but not which post-crash disk states are possible. Each file system, and each mode of the same file system, answers differently, so developers guess. Meanwhile, applications such as SQLite and LevelDB sit on file systems instead of raw disks and must still survive crashes, using complex update protocols to stay both consistent and fast.

The file-system techniques that keep metadata consistent (logging, copy-on-write, soft updates) are taken as heavily tested. One of them is the idea behind the [Log-Structured File System](/papers/log-structured-file-system). The paper asks what those guarantees give to the applications above, not whether the file systems themselves are correct.

The catalog pairings in this paragraph are mine, not the paper's. HDFS is a descendant of the design of [The Google File System](/papers/google-file-system), and [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems) is one of the eleven applications analysed. File systems that change what a crash can leave behind, such as the split journaling of [Oxbow](/papers/oxbow-coordinated-architecture-for-multi-component-file-systems) or the userspace design of [Trio](/papers/trio-high-performance-and-secure-userspace-nvm-file-systems), are file systems whose crash behavior an APM could describe, though neither paper uses ALICE.

Worth knowing first: what fsync does and does not flush, why a rename is used to update a file "atomically", and what delayed allocation is.

## Contribution

- **Persistence properties.** The paper names the file-system behaviors that matter after a crash and splits them in two: atomicity (is a write, append or rename all-or-nothing, in size and in content) and ordering (can a call be persisted after a later one).
- **BoB (Block Order Breaker).** A tool that records the block I/O of a small workload under a file system, reorders it into legal on-disk states, runs file-system recovery and checks whether a property holds.
- **ALICE (Application-Level Intelligent Crash Explorer).** A framework of about 4000 lines of Python that derives crash states from the system-call trace of an application, under an abstract persistence model (APM), and reports the vulnerabilities tied to source lines and to the persistence property each one needs. It also draws protocol diagrams of the update protocols.
- **A study of eleven applications.** LevelDB, GDBM, LMDB, SQLite, PostgreSQL, HSQLDB, Git, Mercurial, HDFS, ZooKeeper and VMware Player, with 60 vulnerabilities found.
- **ext3-fast.** A hypothetical ext3 variant, modelled in ALICE and not implemented, where fsync persists only the synced file and other data stays in order among itself.

## Methodology

**BoB.** A user-supplied workload stresses one property (for example overwrites of a given size). BoB collects the block trace, reorders blocks while obeying disk barriers, writes selected blocks to disk, runs recovery and checks the property. Finding one failing image proves a property does not hold, but the converse cannot be proved: only simple reorderings and all prefixes of the trace are tested. It studied six Linux file systems (ext2, ext3, ext4, btrfs, xfs, reiserfs) in 16 configurations.

**ALICE.** The user supplies an initial snapshot, a workload script and a checker script that verifies the workload's invariants. ALICE runs the workload, converts the system-call trace (writes, pwrite, writev, mmap writes and so on) into logical operations (overwrite, append, truncate, link, unlink, rename, stdout) and splits them into micro-operations: write block, change file size, create dir entry, delete dir entry, stdout. The APM sets which micro-operations are atomic and which can reach disk before others. The default APM is weak: it only orders operations before a sync on the same file. ALICE then builds crash states in three ways: prefixes of the call sequence (atomicity across calls), partial states of a single call (a write split into blocks or into three parts, and appends whose new blocks hold random data, modelling the size reaching disk first) and, for each pair of calls A and B, the state with everything up to B applied except A (ordering). Crash states are hashed to skip duplicates and checked in parallel threads. Static vulnerabilities are source lines, found with stack traces, and dynamic ones are the affected calls.

**Applications.** The workloads test 34 configuration options. The checkers are the authors' and can be large (about 500 lines for Git). Where documentation promises nothing, a lay user's expectation counts as the invariant.

## Findings

- **File systems differ widely.** Table 1 of the paper shows that single-sector overwrites are atomic in every tested configuration, directory operations such as rename are seemingly atomic on journaling and copy-on-write file systems, and multi-block appends are not atomic anywhere (a prefix of the data seems atomic). Ext3, ext4 and reiserfs in data journaling mode, and ext2 in sync mode, persist all tested operations in order. Ext2 and btrfs reorder directory operations freely. With delayed allocation an append can be persisted after later operations, except the append-then-rename idiom.
- **60 static vulnerabilities (156 dynamic).** Applications failed in more than 4000 crash states. Per application: LevelDB 1.10 has 10, HSQLDB 10, Mercurial 10, Git 9, LevelDB 1.15 6, GDBM 5, ZooKeeper 4, HDFS 2, LMDB 1, SQLite (rollback) 1, PostgreSQL 1, VMware 1, SQLite in WAL mode 0.
- **Types.** 27 ordering vulnerabilities and 12 durability ones (seven applications lose durability). Table 3(a) lists atomicity columns of 6 (across calls), 4 (appends and truncates), 3 (single-block overwrites) and 9 (renames and unlinks); the columns sum to 61 because the same lines can exhibit different behavior. In the text: 7 of 11 applications fail without ordering, 10 of 11 expect some atomicity and 7 of 11 do not get the durability a user would expect, often because a directory is not fsynced.
- **Consequences.** 5 silent errors, 12 data loss, 25 cannot open, 17 failed reads or writes. Seven applications are affected by data loss, and both LevelDB versions and HSQLDB by silent errors.
- **Specific patterns.** Three applications (HSQLDB, LevelDB 1.15, Mercurial) need appends to be content-atomic. LMDB, PostgreSQL and ZooKeeper need overwrites under 200 bytes to be atomic. No multi-block overwrite vulnerability was found. The safe-rename heuristic fixes only three vulnerabilities, and three applications need an fsync on a file to also persist its directory entry.
- **Current file systems.** Of the 60, the number exposed is 16 on ext3 writeback, 12 on ext3 ordered, 10 on ext3 data journaling, 17 on ext4 ordered and 31 on btrfs. Some applications show none on any modelled file system.
- **Developers.** The authors contacted developers of eight applications. LevelDB 1.10 was fixed, LevelDB 1.15 was fixed in parallel, and HDFS and two ZooKeeper issues were under consideration. SQLite does not give durability under rollback journaling, though its documentation suggests it does.
- **ext3-fast.** The ordering vulnerabilities of the studied applications are not exposed under it. A 250 MB write to one file followed by an fsync of another file took about four seconds on ext3 ordered and 40 ms on separate partitions mimicking ext3-fast, 100 times faster.

## Critical Analysis

The limits are stated by the authors. ALICE is not complete and may miss vulnerabilities. It needs a human to write workloads and checkers, and it serializes threads in the order calls were issued. It does not handle file attributes. The study counts source lines that depend on file-system behavior, so it is explicitly not suitable for comparing the correctness of applications. Several vulnerabilities come from the authors' reading of user expectations, not from documented guarantees (marked with an asterisk in Table 3). ALICE hides further vulnerabilities in a system call once it has found one for that call. BoB can only refute properties.

What the paper does not do: the models cover atomicity, ordering and the garbage-content append. The text does not model media errors, bit rot, or a lying disk cache that ignores fsync, which developers raised as a suspicion. It tests single-machine workloads, including for HDFS and ZooKeeper. It does not prove any application correct.

Later literature, with sources I only saw as abstracts: Mohan and colleagues (OSDI '18) propose bounded black-box crash testing with the tools CrashMonkey and Ace. They test file systems themselves with workloads of fsync-related calls, and report 10 new bugs in mature Linux file systems. That is a different target than this paper, which tests applications against a model.

## Further Research

- Standardizing persistence properties so that applications and file systems can state them.
- Automating workloads and checkers, for example with model-checking techniques, which the authors call orthogonal to ALICE.
- Evaluating new file-system and storage designs (such as byte-granularity NVM) at design time with an APM.
- Giving applications better interfaces than fsync on files and directories, noting that fsync of a directory is not easy to reach from Java.

---
title: "TreeSLS: A Whole-system Persistent Microkernel with Tree-structured State Checkpoint on NVM"
summary: TreeSLS runs a microkernel directly on non-volatile memory and treats the whole system as a capability tree that it checkpoints about every millisecond, holding back externally visible output until the next checkpoint so that unmodified applications get persistence and external synchrony.
researchArea: Operating Systems
keywords: single-level store, microkernel, non-volatile memory, checkpointing, capability tree, external synchrony
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Conventional operating systems run on volatile DRAM and persist data through files, so applications shuffle data between a memory tier and a storage tier. The authors point to crash-consistency bugs in file systems and in applications built on them, and to the cost of swapping between the tiers. A single-level store (SLS) removes that burden: applications run in one level of memory while the system checkpoints everything transparently, which also gives near-instant recovery. Earlier SLSs such as EROS and Aurora still sit on DRAM plus disk, and the authors name two problems: checkpointing is costly (write amplification, and a checkpoint frequency limited by slow storage), and external synchrony is hard, meaning state that has been shown to the outside world must already be persistent. Existing SLSs answer the second with journaling APIs, which pushes persistence code back into applications.

This SOSP 2023 paper (Koblenz), from the Institute of Parallel and Distributed Systems of Shanghai Jiao Tong University and the Engineering Research Center for Domain-specific Operating Systems of China's Ministry of Education, proposes TreeSLS. Its observation is that a microkernel keeps its state in capability-referenced kernel objects, so the state of the whole system forms one tree that is easy to checkpoint, and that byte-addressable NVM lets the same memory serve as runtime and storage.

Five terms are worth keeping straight. The capability tree groups all kernel objects, and every process is a subtree. A PMO (physical memory object) is a set of physical pages. A stop-the-world (STW) pause is the time all cores are halted to take a checkpoint. External synchrony means a response is released only after the state behind it is persistent. eADR is the Intel feature that flushes CPU caches to NVM on power failure, while CPU and device registers are still lost.

Worth knowing first: virtual memory, page faults and copy-on-write, capabilities in microkernels, and write-ahead logging, which the evaluation uses as the baseline. The paper cites seL4 as a capability microkernel, and [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) is a later microkernel that also keeps drivers and network stacks in userspace. Two pairings of mine, not the paper's: [Snap](/papers/snap-microkernel-approach-to-host-networking) also moves networking out of the kernel, and [μFork](/papers/ufork-posix-fork-within-a-single-address-space-os) notes that Redis snapshots rely on `fork`, whereas TreeSLS persists Redis without any application code.

## Contribution

- **The capability tree is the whole state.** The kernel objects are Cap Group, Thread, VM Space, PMO, IPC connection, Notification and IRQ notification, all reachable from a root Cap Group. Derived state such as scheduler queues is rebuilt on recovery, and page tables, which live in DRAM, are rebuilt lazily by page faults. Each object has an ORoot record that points to its runtime and backup copies, so a shared object is checkpointed once and untouched objects are skipped, which makes checkpoints incremental.
- **A failure-resilient checkpoint manager.** An in-kernel module owns the NVM allocator (a buddy system plus slabs, metadata on NVM). Its own state is not checkpointed, since that would be circular. Redo/undo journaling protects it, and on reboot the journal is applied first and the system is restored afterwards.
- **The checkpoint procedure.** A leader core sends IPIs to quiesce the others, copies the capability tree into a backup tree without copying user pages (they are marked read-only), while the other cores speculatively copy pages. A global version number is then incremented atomically as the commit point, and cores resume. A later write faults and copies the page into the backup.
- **Versioning that uses the runtime page as a backup.** Because runtime pages are already on NVM, a PMO page needs at most one extra backup page, and other objects keep two backups next to the runtime copy. On recovery a backup whose version equals the global version is used, and a page with an older or no backup is taken from the runtime page.
- **Hybrid copy.** The authors compare stop-and-copy, speculative stop-and-copy, copy-on-write and speculative copy-on-write. Their hybrid counts hotness on page faults, keeps hot pages on a dual-function active page list, migrates them to DRAM and copies them with stop-and-copy on cores that would otherwise idle during the pause. Cold pages stay on NVM with copy-on-write. Migration needs a second backup per page, with its own recovery rules.
- **Delayed external visibility.** User-space drivers register a checkpoint callback and a restore callback, and keep their ring buffers in an eternal PMO, which is never rolled back. A message appended to the send queue only becomes visible to the device when a checkpoint advances a visible-writer pointer. Applications need no change, drivers do.
- **Size.** TreeSLS builds on ChCore, an educational multicore microkernel with POSIX support through musl-libc and about 21 k lines in the kernel. It adds about 5 k lines to the kernel (about 3.3 k for checkpoint/restore, about 1.2 k in the allocator) and about 500 lines to the user-space network server.

## Methodology

All experiments run on one machine with two Intel Xeon Gold 6330 CPUs with eADR, fixed at 2.0 GHz with hyperthreading on and turbo off. TreeSLS uses one NUMA node, with 256 GiB of DDR4 and 1 TiB of Intel Optane Persistent Memory. Workloads are the Phoenix 2.0 suite (WordCount, KMeans, PCA), Redis 6.0.8, Memcached 1.6.21, LevelDB, RocksDB 6.6 and SQLite, compared with Linux 5.4 and Aurora. Functional tests crash and reboot the machine by hand while hello world, ping-pong, simple key-value stores and the real applications run.

Pause time is measured at 1000 Hz, with breakdowns per workload and per object type. Runtime overhead is measured by adding mechanisms one at a time (checkpoint, page fault, page copy, hybrid copy), by varying the checkpoint interval for Memcached, and by an external synchrony test with 50 Redis clients. Redis is run under YCSB against Linux with its own log (Ext4-DAX on Optane, Redis built with musl-libc for fairness). RocksDB runs Facebook's Prefix_dist workload against Aurora, which the authors configure with DRAM as storage and a 5 ms checkpoint interval. The application tests run with external synchrony disabled.

## Findings

These are the authors' reported results.

- **Pause time.** With no workload the STW checkpoint takes about 25 μs. SQLite and LevelDB are similar, and more complex multi-threaded applications finish in around 100 μs. Incrementally checkpointing a single object takes at most 3.28 μs. The first rounds are full checkpoints and cost more, up to about 4 ms for the PMOs of a 100 MiB Phoenix data file.
- **Hybrid copy.** The pause itself adds marginal overhead, and most comes from page faults and page copying. Hybrid copy removes up to 49% of the overhead. For Memcached, 395 pages are cached as hot, 40% of them are modified between checkpoints, and 46% of the 338 modified pages are copied speculatively while the other 182 fault. The share of page faults eliminated is 89% for Redis, 95% for KMeans and 11% for PCA.
- **Checkpoint frequency.** On Memcached with 10 million keys, latency grows as the interval shrinks below 10 ms, and a 1 ms interval adds 11 to 160 μs.
- **External synchrony.** In the Redis SET test, delaying responses raises latency by about one checkpoint interval, and throughput still suffers because blocked clients sit on the critical path.
- **Redis against its log.** On write-heavy YCSB workloads (100% update, 100% insert) TreeSLS at 1 ms loses 18% to 21% of its own baseline throughput, Linux with its log loses 64% to 78%, and TreeSLS's absolute throughput is 1.9× to 2.2× that of Linux with its log. On workload A it is 28% ahead. On the read-heavy workloads B and C it falls behind Linux with its log, which logs nothing for reads. The text gives 30% and 15% degradation without naming the reference.
- **RocksDB.** Against its own baseline, TreeSLS at 1 ms loses 10% of throughput and adds 22% (P50) and 69% (P99) write latency, and at 5 ms the figures are 2%, 6% and 32%. Aurora at 5 ms loses 9% and adds 43% (P50) and 4.2× (P99). The authors also report 2.4× and 2.5× the throughput of Aurora's journaling API and of RocksDB's log. They say it takes Aurora 5 to 7 ms to persist a checkpoint even with DRAM as storage, and about 100 ms with an SSD.
- **Functional tests.** All the programs resumed with the expected behavior after manual crashes.

## Critical Analysis

The paper is open about several limits. It concedes the following.

- **Uniform persistence.** Applications and data differ in what they need to persist, and persisting everything may keep unnecessary data.
- **NVM reliability and capacity.** Corruption or failure of the NVM breaks TreeSLS. Multiple checkpoint versions, replication and erasure coding are proposed, not built. Memory over-commitment is not handled, and a cold page list is left as a sketch.
- **External synchrony is partial.** It is implemented in a network server for communication between clients and servers on the same machine, with real network drivers still in progress. Drivers must be changed to use the TreeSLS API, and delaying output by up to one checkpoint interval only works if checkpoints are frequent.

The following points are a reading of the evidence, not claims of the paper.

- **The headline comparisons use different guarantees.** The application tests run without external synchrony, so the 1 ms of added latency is stated, not measured there, and acknowledged writes can still be lost within the last interval. The log on the other side records each write, and the text does not give Redis's sync policy. The 1.9× to 2.2× ratio therefore compares unlike durability points.
- **Cross-system ratios mix bases.** The authors say TreeSLS's baseline is slower than Aurora's FreeBSD because of a different libc, and that TreeSLS at 1 ms has lower absolute performance than Aurora at 5 ms. The 2.4× and 2.5× figures do not name the TreeSLS configuration, Aurora uses DRAM as storage, and Aurora's log lives on DRAM, so it is not durable.
- **Correctness evidence is light for arbitrary power failures.** Testing is manual crash and reboot, and the argument is a short informal paragraph. Journaling, version rules and migration rules interact, yet there is no systematic crash injection or verification. [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) shows what verifying kernel invariants looks like, though it proves other properties and not persistence (my pairing).
- **Scale and hardware are narrow.** The largest application memory in Table 2 is 1015 MiB on a 1 TiB device, Redis adds 262 PMOs to a default of 71, and checkpoint cost grows with object counts and sizes, per the authors. Many-process, many-core and tens-of-GiB cases are untested. Only Optane with eADR on one NUMA node is used.
- **Two internal inconsistencies.** The text says checkpoint size is much smaller than runtime memory, yet Table 2 lists larger checkpoints for KMeans (134 against 15 MiB) and Redis (316 against 129 MiB). In Table 4 the dirty-rate row for Redis (33%) and KMeans (37%) does not follow from the counts above it (89 of 241 is 37%, 197 of 431 is 46%). Also, "up to 49%" is the best case, since PCA eliminates only 11% of its faults.
- **Inputs are not discussed.** Delaying outputs covers responses. The text does not say what happens to requests received after the last checkpoint, or to transport state such as TCP connections, after a rollback. The evaluation uses machine-local UDP-like communication.

## Further Research

- External synchrony in real network and storage drivers, including restoring device state, which the authors say they are working on.
- Protecting the NVM state with multiple checkpoint versions, replication or erasure coding, plus the eidetic-system extension that lets a user navigate past versions, for example for debugging.
- Selective persistence, so that applications or memory regions can opt out of checkpointing, which would answer the uniform-persistence limit (a gap I see, not a plan in the paper).
- Systematic crash injection or formal verification of the checkpoint manager and recovery rules, and tests with many processes, many cores and larger memory (also my gap).

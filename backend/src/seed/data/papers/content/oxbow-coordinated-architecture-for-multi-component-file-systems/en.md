---
title: "Oxbow: A Coordinated Architecture for Multi-component File Systems"
summary: Oxbow splits a file system across a user-level library, a trusted user-level server, a thin kernel shim and a computational SSD, so reads use the kernel page cache, writes bypass the kernel, and background journaling runs on the device without slowing fsync.
researchArea: Operating Systems
keywords: file systems, computational storage, kernel bypass, split journaling, page cache, fsync
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Fast NVMe SSDs and computational SSDs (CSDs, drives with their own ARM cores) have split the storage stack into three camps. Kernel file systems such as Ext4 have rich services but pay for the kernel I/O path and become CPU-bound. User-level file systems such as µFS skip the kernel and lose the page cache, readahead, protection and zero-copy calls like `sendfile()`. In-device file systems save host CPU but suffer from PCIe latency and weak device processors.

This OSDI 2026 paper, from the University of Illinois Urbana-Champaign and KAIST, argues that the either-or choice is the problem. Oxbow places each operation where it fits best, aiming at four goals together: high performance, kernel interoperability, low host CPU use and fast development.

Four names are worth keeping apart: oxLib is the per-application library, H-Server is the trusted user-level file server that owns the device, illuFS is the thin kernel shim that plugs into the VFS, and D-Server runs on the CSD and does background journaling. Split Journaling is the mechanism that ties the host and the device together.

Worth knowing first: the page cache and `mmap`, what `fsync` promises, data versus metadata journaling (as in Ext4's JBD2), and user-level storage drivers like SPDK. [Snap](/papers/snap-microkernel-approach-to-host-networking) applies the same move of services out of the kernel to host networking, and Oxbow cites it as a user-level example.

## Contribution

- **Coordinated architecture.** Foreground operations stay on the host to avoid PCIe round trips, the kernel keeps caching, protection and sharing, and the device gets only background work that tolerates latency (journaling, checkpointing, and in principle garbage collection or compression).
- **Semi-kernel-bypassing I/O.** oxLib turns reads and writes into loads and stores on `mmap`-ed files. A read faults into the kernel, illuFS asks H-Server to fill the page cache, and the kernel's readahead works unchanged. Writes store into the page cache without a system call, and `fsync` goes straight to H-Server, which writes through a user-level driver.
- **Shared-ownership metadata.** Inode fields are split into small groups with a single writer each: oxLib owns size and timestamps, the kernel owns uid, gid and mode, and H-Server only reads them. They live in shared memory, mapped read-only where a component does not own them, with oxLib treated as untrusted. oxLib also keeps per-file dirty-page and page-lock bitmaps, so H-Server finds dirty pages and avoids racing with writers.
- **Split Journaling.** An fsync writes the file's data and inode into a persistent staging area on the host and returns, without waiting for the journal. Background commits batch many files, with D-Server pulling a contiguous DMA buffer into device memory and writing the journal. Each staging transaction is self-contained, so no ordering dependency ties fsync to background commits. The DMA buffer doubles as a shadow copy, so writers block only while pages are copied.
- **Crash consistency and failures.** The invariant is that every fsync-ed file is recoverable from its staging transaction plus the journal prefix it records. Components are fail-stop, H-Server can simply be relaunched after a host-side failure, and D-Server can run on the host if the CSD's compute is lost.

## Methodology

The authors implement Oxbow in 53K lines of C/C++, excluding lwext4, which supplies H-Server's Ext4-style logic with its own journaling disabled. illuFS targets Linux kernel 6.2. No real CSD was used: it is emulated with an NVIDIA BlueField-2 DPU (eight 2.0 GHz ARM cores, 16 GB of DRAM) and a Samsung PM1735 SSD that supports SR-IOV and namespace sharing, with the DPU reaching the SSD through NVMe-oF. The host is a dual-socket Xeon Gold 5218 with 128 GB of DRAM.

Baselines are Ext4 in data journaling mode, µFS in its zero-copy mode, and OmniCache, which the authors extended to run against a device instead of persistent memory. The evaluation uses the µFS microbenchmarks for latency, throughput, CPU use and metadata operations, an ablation with three variants (host journaling, no staging, no background journaling), and four applications: LevelDB under YCSB, a RAG retrieval benchmark, LLM checkpointing and Nginx with `sendfile`.

## Findings

These are the authors' reported results.

- **Write latency (an fsync after each write).** Oxbow is 2.1× to 3.5× lower than Ext4 for appends, 1.2× to 1.8× for sequential writes and 1.2× to 1.9× for random writes. µFS is up to 43% faster, which the authors attribute to Oxbow's two extra memory copies.
- **Read latency.** For 4KB I/O, sequential reads are 18.2× lower than µFS thanks to readahead, and random reads are 5.5× lower than Ext4 and 7.7× lower than µFS. Ext4 still beats Oxbow on sequential reads by 3% to 29%.
- **Write throughput.** Up to 86% above µFS, and 2.7× to 4.6×, 1.4× to 4.5× and 1.3× to 4.8× Ext4 for append, sequential and random writes. The authors credit file-granularity transactions against JBD2's contention.
- **fsync time.** With one client it is 16.8× to 19.2× lower than the second-best system, but with 10 clients the gap shrinks to 2.0× to 2.2× as bandwidth saturates.
- **Read throughput.** Sequential reads are 10.5× to 18.5× µFS but 0.2% to 24% below Ext4 until the readahead window grows from 32 to 128 pages, after which Oxbow wins every case. Random reads are the highest of all systems.
- **Host CPU.** Bytes per CPU cycle on writes are 1.8× to 3.9× µFS and 1.3× to 4.7× Ext4, and the paper reports up to 55% less host CPU than µFS. The background journaling thread uses about 0.1 core. Efficiency falls as clients grow, because bursts of fsync leave less to offload.
- **Ablation.** Journaling on the host costs up to 21% throughput and up to 44% more host CPU. Without staging, latency is about 7.8× higher. Without background journaling, throughput is up to 33% lower and fsync time up to 8.8× higher, though it still beats Ext4.
- **Applications.** On YCSB, Oxbow leads µFS by 83% and 89% on workloads B and C with one process (34% and 37% with eight), and leads Ext4 by 41% and 17% on E, but is 20% behind µFS on D with eight processes. RAG probes see 50% lower I/O latency than Ext4 (up to 45% lower at the tail), while average end-to-end latency is 40 ms for both. LLM checkpointing gains 58% throughput and 46% lower latency over Ext4, with OmniCache close behind. `sendfile` raises Nginx throughput 3.3×, against 3.6× on Ext4.
- **Metadata (appendix).** `stat` and `statall` scale linearly, reaching up to 19× and 10× µFS and 57× and 30× Ext4 at 10 clients. `create` and `unlink` trail Ext4, and `rename` scales 5.5× from 1 to 10 clients.

## Critical Analysis

The paper has no limitations section, but its evaluation text concedes several costs.

- **Extra copies on both paths.** Writes copy from the application buffer to the page cache and again to an SPDK buffer at fsync, and reads add two kernel to H-Server context switches and a copy. The price of reusing the VFS is visible in write latency against µFS and in sequential reads against Ext4.
- **Offload gains fade under load.** The fsync gap closes from about 17× to 2× as clients rise, and efficiency falls. Namespace operations such as `create` and `unlink` cross both H-Server and the kernel and trail Ext4.

The following points are a reading of the evidence, not claims of the paper.

- **The CSD is emulated.** A DPU reaching the SSD over NVMe-oF is a reasonable proxy for host CPU savings, as the authors argue, but journaling throughput, DMA behavior and queueing on a real CSD are not measured. The paper attributes OmniCache's slow random writes to CSD CPU bottlenecks, but its 20.8 s fsync time with one client (828× Oxbow's) also shows how much a baseline port can matter.
- **Baselines are mostly conservative.** µFS runs in its zero-copy mode, its client-server busy-wait cycles are excluded from the efficiency metric, and Ext4 gets a 39 GB journal and a raised checkpoint threshold so it does not stall. That favors the baselines, so the gains are credible, but they come from one machine and one SSD, with µFS limited to 10 clients.
- **Headline numbers are best cases.** "Up to 4.8×" and "up to 55%" are maxima over workloads and client counts, while the application benchmarks show smaller gains (up to 89% on YCSB, and a loss on workload D). In RAG, end-to-end latency is unchanged, so the I/O gain does not reach the user there.
- **Development velocity is barely measured.** It is one of the four goals, yet the evidence is the 53K line count and the observation that `sendfile` works without extra code. There is no comparison of effort, and H-Server's pluggable interface is shown with a single logic (lwext4).
- **Crash consistency and security are argued, not tested.** The invariant and recovery procedure are described, but I found no crash-injection experiment, recovery-time measurement or write amplification figure, although data journaling with staging and checkpointing writes data more than once. The paper also does not discuss what an untrusted oxLib that never releases a page-lock bit would do to other writers or to H-Server's copy at fsync.

## Further Research

- Running on real CSD hardware, and offloading other background work the paper names, such as garbage collection and compression, or targeting ZNS, FDP and CXL SSDs.
- Other file system logic behind H-Server's pluggable interface, which the artifact is meant to support, beyond the Ext4-style layout from lwext4.
- Removing the extra copies on the read and write paths and adopting µFS-style directory prefetching on `opendir`, which the paper says Oxbow could also adopt.
- Crash-injection testing with recovery times, and defenses against a misbehaving oxLib holding locks, measured under multi-tenant load.

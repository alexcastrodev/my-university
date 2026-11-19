---
title: "XRP: In-Kernel Storage Functions with eBPF"
summary: XRP lets an application register an eBPF function that the NVMe driver runs on each read completion, so a chain of dependent reads such as a B-tree traversal is resubmitted from the interrupt handler without crossing the kernel storage stack or returning to user space.
researchArea: Operating Systems
keywords: xrp, ebpf, nvme, storage stack, io resubmission, kernel bypass, linux kernel
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

With the emergence of microsecond-scale NVMe storage devices, the Linux kernel storage stack overhead has become significant, almost doubling access times. We present XRP, a framework that allows applications to execute user-defined storage functions, such as index lookups or aggregations, from an eBPF hook in the NVMe driver, safely bypassing most of the kernel's storage stack. To preserve file system semantics, XRP propagates a small amount of kernel state to its NVMe driver hook where the user-registered eBPF functions are called. We show how two key-value stores, BPF-KV, a simple B+-tree key-value store, and WiredTiger, a popular log-structured merge tree storage engine, can leverage XRP to significantly improve throughput and latency.

## Overview

On an Intel Optane P5800X, the paper measures a 512 B random `read()` at 6.27 µs, of which the device is 51.4% and software 48.6%: ext4 is 2006 ns (32.0%), the block layer 379 ns, the kernel crossing 351 ns, the syscall 199 ns and the NVMe driver 113 ns. On older fast devices the software share was about 15%. An index lookup makes this worse, because each level of a B-tree or LSM index is a read whose result the application uses only to compute the next offset, so every level pays the whole stack.

This OSDI 2022 paper (Carlsbad, July 2022), mostly from Columbia University, asks for something deployable on stock Linux, ext4 and existing applications. Kernel bypass with SPDK removes the overhead but forces a user-space file system, gives up isolation and needs polling, and the authors report a 3x throughput loss when threads outnumber cores. The paper's kernel-bypass related-work group cites [Arrakis](/papers/arrakis-operating-system-is-the-control-plane), [IX](/papers/ix-protected-dataplane-operating-system) and [Demikernel](/papers/demikernel-datapath-os-for-microsecond-datacenter-systems) as systems that let users reach the device directly. XRP takes the opposite route: it keeps the kernel in charge and moves a small piece of application logic into it, inspired by XDP in networking.

[io_uring](/papers/efficient-io-with-io-uring) is not the answer, the paper argues: it batches submissions and saves crossings, but each I/O still passes through every layer, so it is complementary. Figure 3 shows the NVMe hook raising io_uring throughput by up to 1.5x at small batch sizes and up to 2.5x as batches grow.

Terms to keep apart: resubmission is issuing the next read of a chain from inside the kernel, the metadata digest is the small file-system state the driver needs to translate offsets, and the scratch buffer is a 4 KB per-request area shared by the application and the eBPF function.

Two pairings of mine, not the paper's. [cache_ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) (SOSP 2025) shares authors Ioannis Zarkadas and Asaf Cidon and extends the page cache with eBPF, the layer XRP explicitly does not touch; its catalog analysis does not mention XRP. [PeeR](/papers/peer-first-class-scheduling-for-latency-critical-ebpf-applications) (OSDI 2026) is later literature, see Critical Analysis.

## Contribution

- **A new datapath.** The hook sits in the NVMe interrupt handler, under the syscall, file system and block layers. The paper's motivating experiment (Table 2, a depth-10 on-disk B-tree, taken from the authors' earlier HotOS 2021 paper) puts resubmission at the syscall layer at 1.15x latency and 1.2x throughput, and at the NVMe driver at 1.95x and 2.5x.
- **A new eBPF program type.** `BPF_PROG_TYPE_XRP` programs receive a context with `data` (the block just read), `done`, `next_addr[16]` and `size[16]` (fanout up to 16, a zero size issues no I/O) and `scratch`. The application calls `read_xrp()`, which is `pread()` plus the program's file descriptor and a scratch pointer.
- **Reusing the dispatch path.** On completion the handler calls the function, asks the metadata digest to translate the next logical address, then rewrites the physical addresses in the just-completed `nvme_command` and appends it to the submission queue of the same core. No `kmalloc` is needed. The kernel changes are about 900 lines, about 500 for the hook and driver and about 400 for translation.
- **The metadata digest.** Two functions, `update_mapping` (called by ext4 when extents are inserted or removed) and `lookup_mapping` (called from the interrupt handler). The ext4 version caches the extent status tree and uses RCU, with an average lookup of 96 ns. A per-extent version number is checked again after the read, and a mismatch aborts the chain. This is also the access control: a request outside the open file returns to user space with an error.
- **Verifier change.** `data` and `scratch` are `PTR_TO_MEM`, and `is_valid_access()` passes their size to the verifier for bounds checks. The authors say the eBPF maintainers consider the change sensible.
- **Page cache and fallback.** XRP does not interface with the page cache and assumes applications run `O_DIRECT` with their own user-space caches. It is best effort: on any failure the application retries or falls back to ordinary syscalls.

## Methodology

Hardware is a 6-core i5-8500 at 3 GHz with 16 GB of memory and an Intel Optane P5800X prototype, Ubuntu 20.04 and Linux 5.12.0 (the Section 2 measurements use 5.8.0). All runs use `O_DIRECT`, hyperthreading off, C-states and turbo boost off, and KPTI on. Baselines are XRP, SPDK, `read()` and io_uring.

BPF-KV is a purpose-built store with a B+-tree index of 512 B nodes (31-way fanout) and an unsorted log, 8 B keys and 64 B values, with BPF functions for lookup, range queries and aggregations (up to 32 key-value pairs per syscall). Latency tests do a million uniform random lookups with caching disabled. WiredTiger 4.4.0 (about 500 changed lines) runs YCSB on 1 billion 16 B pairs (46 GB), with 512 MB to 4 GB caches, up to 3 client threads and a 512 B page size. Its BPF function ports the page parser and returns traversed pages so WiredTiger can cache them.

## Findings

- **Lookup latency (Table 3).** With 1 to 6 index I/Os, XRP takes 10.7 to 29.3 µs, `read()` 13.4 to 48.8 µs, io_uring 13.6 to 49.3 µs and SPDK 5.2 to 20.2 µs. Each extra level adds 3.5 to 3.9 µs for XRP, close to the device. At 6 levels XRP is 45% slower than SPDK and `read()` is 142% slower.
- **BPF-KV headline.** The introduction reports, with multiple threads and a 3-level on-disk index, 47% to 94% higher throughput and 20% to 34% lower p99 latency than `read()`. A single thread cuts p99 and p99.9 by up to 30% (closed loop, so XRP also runs at higher throughput). Chart reading from Figure 6a: single-thread throughput at depth 6 is about 34 against about 20 kOps/s for `read()`.
- **Sharing cores.** The introduction gives 56% better p99 than SPDK with two threads on the same core. In the open-loop test XRP holds near the hardware limit as threads go past 6 cores, while SPDK falls (chart reading from Figure 7a: about 200 against about 680 kOps/s at 22 threads). SPDK requests at or above 1 ms are 0.03% at 7 threads and 0.28% at 24, and under 0.01% for the others.
- **Range queries.** Capping 32 objects per syscall adds negligible overhead, and the speedup stays roughly constant with range length (Figure 8).
- **WiredTiger.** XRP speeds up most YCSB workloads by up to 1.25x and cuts p99 by up to 40%. Gains shrink with larger caches and higher Zipfian skew, and are not significant on YCSB D and E. WiredTiger spends 63% of its time on I/O, so the gain is smaller than on BPF-KV.

## Critical Analysis

The paper states these limits itself.

- **Scope.** One file at a time, data structures whose layout is stable for seconds or more, and no support for operations that need locks. Only reads are accelerated; updates and inserts are absorbed by WiredTiger's memory buffer. Only ext4 is implemented, with f2fs sketched as feasible.
- **Where XRP does not help.** Reads served from the application cache, indices that fit in DRAM, and the first I/O of every chain, which still crosses the whole stack. YCSB E scans gain little because the iterator reads one pair at a time. Under `O_DIRECT` the page cache is out of the picture.
- **Prototype gaps.** No hard resubmission limit (a counter is proposed), a resubmitted request fetches only as many physical segments as the first one, and the I/O scheduler is bypassed. The interrupts XRP chains can starve a compute-heavy process on the same core, which got about 34% of a fair share in the worst case, and the authors leave this open.
- **Local device.** Everything runs on one local NVMe device; networked storage is future work.

My reading, not claims of the paper:

- **One machine and one prototype drive.** I found no repetition counts or error bars. The introduction says "up to 24%" for WiredTiger while Section 6.4 says up to 1.25x, and the 2.5x in the contribution list matches the Table 2 best case more than the BPF-KV text.
- **Co-designed store.** BPF-KV was built for the hook, and the SPDK collapse concerns oversubscribed cores, a configuration SPDK deployments usually avoid.
- **Security rests on the digest.** I found no experiment with a hostile function or racing extent changes.
- **Later literature, not read in full.** I only read the catalog analyses. PeeR's analysis says XRP's block scan loops about 100 instructions up to 2,000 times with no helper call, which limits preemption, and that its authors did not build the XRP adapter. cache_ext's analysis covers eviction policy in the page cache, the layer XRP leaves alone.

## Further Research

- Other storage functions on the same hook: compaction, compression and deduplication, as the authors envision.
- XRP as a common interface to programmable storage or FPGA offload, and chaining XRP with XDP to bypass both network and storage stacks.
- Other file systems through their own metadata digest, a resubmission limit and a fix for the scheduler interference.
- Cooperation with the page cache and with writes, which the design leaves out.

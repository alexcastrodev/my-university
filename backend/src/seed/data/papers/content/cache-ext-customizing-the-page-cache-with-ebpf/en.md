---
title: "cache_ext: Customizing the Page Cache with eBPF"
summary: cache_ext lets each cgroup load its own eviction policy into the Linux page cache as eBPF code, using kernel-managed eviction lists and a registry of valid folios, so that policies from the caching literature run in the kernel without kernel patches per policy and without disturbing other applications.
researchArea: Operating Systems
keywords: page cache, ebpf, eviction policy, cgroups, struct_ops, kfuncs, linux kernel
version: 1.0
updatedAt: 2026-11-07
---

## Overview

The Linux page cache keeps file data in memory and evicts it with one approximate LRU policy built from an active and an inactive list. That policy works for many workloads and badly for others, for example large scans that flush the useful pages. Applications can send hints with `fadvise()`, but the kernel may ignore them and they stay inside the same LRU structure. Changing the policy means patching memory-management code, and upstreaming is hard because a change must suit every workload on Linux. The authors recall that Google's Multi-Generational LRU (MGLRU) took years to merge and is still not enabled by default upstream.

This SOSP 2025 paper (Seoul), from Columbia University and IBM Research, takes its cue from sched_ext, the eBPF-based extensible scheduler, and asks whether the page cache can be extended the same way. The result is cache_ext, a framework where an application loads eBPF programs that decide which pages to admit and evict, without changing the kernel again.

Terms to keep apart: a folio is the kernel's unit of cached memory (one page in all the paper's workloads), a policy function is one of the eBPF callbacks the kernel invokes on a caching event, an eviction list is a policy-owned linked list of folio pointers, and a kfunc is a kernel function exposed to eBPF programs without a stable interface.

Worth knowing first: LRU and why scans hurt it, cgroups as the unit of memory accounting, and the eBPF verifier. The paper cites [ghOSt](/papers/ghost-user-space-delegation-of-linux-scheduling) as a scheduling framework that mitigates the root-privilege problem with a privileged policy loader. It also argues that userspace dispatch, an option in sched_ext, fits scheduling better than eviction because page events are far more frequent than scheduling events, and that is the delegation idea behind ghOSt (that link is mine). A second pairing of mine, not the paper's: [PeeR](/papers/peer-first-class-scheduling-for-latency-critical-ebpf-applications) (OSDI 2026) shares an author, Jeremy Carin, and also builds on eBPF and sched_ext. This paper does not cite it, since it came later.

## Contribution

- **Policies run in the kernel.** The authors first estimate the best case for a userspace design: eBPF programs on existing tracepoints push every folio event through a ring buffer to userspace, which does nothing with them. This alone costs up to 20.6% on their workloads (YCSB, a uniform key-value workload, and a ripgrep search), so cache_ext keeps policy code in the kernel.
- **Five events through `struct_ops`.** A policy implements callbacks for initialization, a request to propose eviction candidates, folio admission, folio access and folio removal. Eviction and removal are separate because a folio can leave the cache by other paths (a deleted file) and because a proposed candidate may not be evictable (the kernel is using it). The hooks needed about 200 lines in the core page cache code.
- **Kernel-managed eviction lists.** eBPF maps offer either order or random access, not both, and the newer eBPF data structures were not mature enough for the authors. Policies instead call kfuncs (`list_create`, `list_add`, `list_move`, `list_del`, `list_iterate`) on lists whose nodes point to folios, with locking done inside the kernel. `list_iterate` runs a callback per node and either picks folios to evict or, in batch-scoring mode, scores N folios and evicts the C lowest, which suits LFU. Candidates go to the kernel in batches of up to 32, and the kernel checks each one.
- **Isolation by cgroup.** Each cgroup can load its own policy, and the authors extend `struct_ops` loading with a cgroup file descriptor (about 220 kernel lines and 75 libbpf lines). Processes can still read pages owned by another cgroup, so memory sharing survives.
- **Safety.** A registry of valid folios, a hash table with per-bucket locks that also maps each folio to its list node, lets the kernel reject bogus pointers returned by a policy. If a policy proposes too few candidates, the kernel falls back to its default policy, and an evicted folio is removed from every list by the kernel. The kfuncs check inputs, bounds and loop termination, and loading a policy needs root.
- **A policy suite.** The authors implement LFU, MRU, FIFO, S3-FIFO, LHD (with scaled integers because eBPF has no floating point, and periodic reconfiguration through a `BPF_PROG_TYPE_SYSCALL` program), a port of MGLRU, an application-informed GET-SCAN policy with two lists and a map of SCAN thread PIDs, and an admission filter that keeps background compaction threads out of the cache (15 extra verifier lines).
- **Size.** The whole patch adds about 2000 kernel lines. Of these, 210 are in the page cache, 80 in the verifier and 80 in cgroup code, and the rest implement cache_ext itself, including 750 lines for the list kfuncs and 580 for the registry.

## Methodology

Experiments run on CloudLab c6525-25g nodes (16-core AMD Rome, 128 GB of memory, 480 GB SSD) with Ubuntu 22.04 and Linux 6.6.8, with CPU pinning, and SMT, swap and address randomization disabled. The page cache is dropped before each test. Baselines are the default kernel policy, MGLRU and the `fadvise()` options (NOREUSE, DONTNEED, SEQUENTIAL).

The workloads are LevelDB, changed to use `pread()` instead of `mmap()`, under YCSB with a 100 GiB database in a 10 GiB cgroup, plus uniform and uniform read-write variants. LevelDB is also driven by production Twitter cache traces from five clusters, each with a cgroup at 10% of the cluster's data. The other workloads are 10 ripgrep searches over the Linux 6.6 sources in a 1 GiB cgroup, a mixed GET/SCAN LevelDB workload (99.95% GET and 0.05% SCAN, with separate thread pools), and RocksDB with uniform reads and writes for the admission filter. Isolation uses two cgroups at once (YCSB C and file search), with four policy combinations. Overhead is measured as registry memory, as CPU per I/O operation with fio on a no-op policy, and by comparing the MGLRU port with the kernel's MGLRU on YCSB.

## Findings

These are the authors' reported results.

- **YCSB.** LFU wins on every workload except YCSB D, which fits in memory, with up to 37% more throughput than the default policy and a larger margin over MGLRU. The authors call LFU the natural fit for a fixed Zipfian distribution. LHD is close to LFU and S3-FIFO also beats the Linux policies, while MRU falls below the baseline and FIFO is slightly above MGLRU but not above the default. P99 read latency is up to 55% lower than the default. Throughput moves inversely with total disk I/O, shown for YCSB A and C.
- **Twitter traces.** No policy wins everywhere. LHD beats the default and MGLRU by 13% and 30% on cluster 34, and LFU by 13% and 34% on cluster 52. MGLRU dominates clusters 17 and 18, the default is best on cluster 24 (where MGLRU consistently ran out of memory), and S3-FIFO matches or beats the baseline on clusters 34 and 52 but not the other cache_ext policies.
- **File search.** MRU is almost 2× faster than both the default policy and MGLRU.
- **GET-SCAN.** The application-informed policy gives 70% more GET throughput and 57% lower GET P99 latency, while SCAN throughput falls 18%. The `fadvise()` options help little, and MGLRU does worse than the default.
- **Admission filter.** RocksDB P99 latency improves 17% (2.61 ms to 2.16 ms) with no meaningful throughput change.
- **Isolation.** With LFU for YCSB and MRU for file search in separate cgroups, YCSB gains 49.8% and file search 79.4% over the baseline. A single global LFU or MRU policy helps its own workload and significantly hurts the other.
- **Effort and overhead.** eBPF code ranges from 35 lines (admission filter) to 689 (MGLRU), with 101 to 262 lines of userspace loader. The registry costs 0.4% to 1.2% of the cgroup's memory. A no-op policy adds at most 1.7% CPU per I/O operation (0.72%, 1.66% and 0.17% at 5, 10 and 30 GiB), and the MGLRU port averages 1% lower throughput (harmonic mean 0.99).

## Critical Analysis

The paper is open about several boundaries. It concedes the following.

- **Isolation is partial.** If cgroup B's policy evicts a page that cgroup A depends on, A suffers, as in stock Linux. The authors argue that applications with very different access patterns rarely share the same files.
- **Privilege and eBPF maturity.** Loading needs root, and the authors only envision a privileged loader as in sched_ext and ghOSt. The registry check, the kernel-side lists and the missing floating point all exist because eBPF cannot yet do these things safely, and they expect newer eBPF features to reduce overhead.
- **Scope.** The study focuses on eviction for file-based accesses rather than memory-mapped pages. Prefetching is left to work such as FetchBPF, which the authors say could be added as another hook.

The following points are a reading of the evidence, not claims of the paper.

- **No run counts or spread.** The text gives no repetition counts or error bars. Differences such as 13% on one Twitter cluster, the 17% RocksDB latency gain or the 1% MGLRU cost have unknown noise, and the MGLRU port's per-workload ratios run from 0.96 to 1.06.
- **Matches are chosen by construction.** LFU on a Zipfian benchmark, MRU on repeated scans, and a GET-SCAN policy fed the PIDs of a workload the authors designed show headroom in the interface, not that these policies generalize. The Twitter traces, where the winner changes by cluster, are the more telling result, and the authors draw that lesson themselves.
- **Related systems are not benchmarked.** P2Cache and PageFlex are compared only in prose, and no userspace-cache baseline is run, although the paper argues against userspace caches. The only userspace design measured is the no-op ring-buffer estimate.
- **Narrow testbed.** One machine type, one kernel and one SSD, with LevelDB, RocksDB and ripgrep as the applications. PostgreSQL and MySQL are named as page cache users but not tested. The CPU overhead test uses 8 threads, so "scalable" is argued rather than measured at high core counts, and isolation is shown for one pair of cgroups.
- **Safety is described, not stressed.** The fallback and registry are explained, but no experiment runs a buggy or hostile policy, or measures how a slow `list_iterate` callback delays eviction.
- **Figures disagree slightly.** The introduction and abstract give up to 38% (generic policies) and 58% lower tail latency, while the body gives 37% and 57%. The text says policies need "at most a few hundred lines", yet the MGLRU port is 689 eBPF lines. The headline 70% also comes with the 18% SCAN loss.
- **Maintenance is not discussed.** The patch is about 2000 kernel lines against 6.6.8 on kfuncs without a stable interface. The paper says nothing about upstreaming or porting across kernel versions.

## Further Research

- ML-based and richer application-informed policies, which the authors name as the next step, together with using their open policy suite as a testbed for new caching research.
- Folding prefetching hooks such as FetchBPF into the same framework, and using eBPF's trusted-pointer tracking to drop the registry check and its memory cost.
- Evaluating adversarial or buggy policies, bounding the time a policy may spend in the eviction path, and giving shared pages across cgroups stronger protection.
- Choosing a policy per workload automatically, since no single one wins on the Twitter traces, and testing on mmap workloads, many-core machines and databases such as PostgreSQL.

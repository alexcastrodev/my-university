---
title: "The Slab Allocator: An Object-Caching Kernel Memory Allocator"
summary: Bonwick describes the SunOS 5.4 kernel memory allocator, which lets clients register a constructor and destructor and keeps freed objects in their constructed state, so allocation skips the setup cost. Memory is carved into reference-counted slabs, returned under memory pressure, and offset by a "color" per slab to spread buffers across the hardware cache.
researchArea: Operating Systems
keywords: slab allocator, object caching, kernel memory allocation, constructed state, cache coloring, memory reclaim, fragmentation
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This paper presents a comprehensive design overview of the SunOS 5.4 kernel memory allocator. This allocator is based on a set of object-caching primitives that reduce the cost of allocating complex objects by retaining their state between uses. These same primitives prove equally effective for managing stateless memory (e.g. data pages and temporary buffers) because they are space-efficient and fast. The allocator's object caches respond dynamically to global memory pressure, and employ an object-coloring scheme that improves the system's overall cache utilization and bus balance. The allocator also has several statistical and debugging features that can detect a wide range of problems throughout the system.

## Overview

A kernel allocates and frees small structures constantly: inodes, stream heads, message blocks, address maps. Bonwick's starting observation is that for many of them the cost of initializing and destroying the object exceeds the cost of getting memory for it, especially once the structure holds a mutex, a condition variable and a reference count, as multithreaded kernels do. A faster `malloc` alone cannot remove that cost.

This USENIX Summer 1994 paper, from Sun Microsystems, documents the allocator that replaced the SVr4 buddy system in SunOS 5.4. It belongs to the kernel tradition that the [UNIX](/papers/unix-time-sharing-system) system started, where the kernel keeps tables of fixed-size records (the i-node is the classic one). Its multicore limits show up later in [Linux scalability to many cores](/papers/analysis-of-linux-scalability-to-many-cores), whose fixes include per-core packet-buffer free lists and per-core vfsmount caches, and a modern verified-memory design is [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness).

Worth knowing first: what a constructor and destructor do, the difference between internal fragmentation (waste inside a buffer) and external fragmentation (free buffers that cannot be used), how a direct-mapped or low-associativity hardware cache maps addresses to lines, and what a reference count is.

## Contribution

- **Object caching in the central allocator.** An object's constructed state (embedded locks, condition variables, reference counts, lists, read-only data) is initialized once, when the object first enters the cache, and preserved across free and reallocation. The paper argues private per-subsystem caches fail because they cannot see global memory pressure, bypass accounting and debugging, and duplicate code.
- **A client-driven interface.** Clients, not the allocator, describe their objects: `kmem_cache_create(name, size, align, constructor, destructor)`, `kmem_cache_alloc(cp, flags)` with `KM_SLEEP` or `KM_NOSLEEP`, `kmem_cache_free(cp, buf)` and `kmem_cache_destroy`. The ordinary `kmem_alloc` and `kmem_free` sit on top, using about 30 caches from 8 bytes to 9K in roughly 10 to 20% steps, and larger requests go straight to the page supplier.
- **Slabs.** A slab is one or more pages cut into equal chunks with a reference count of allocated chunks. Each cache has a front end (`alloc`, `free`) and a back end (`kmem_cache_grow` takes memory from the VM system, `kmem_cache_reap` gives it back), and the caches share no state, so locking is per cache, not one lock over the whole heap.
- **Freelist structure.** Each slab has its own freelist and the cache keeps a circular doubly linked list of slabs, partially sorted: slabs with every buffer allocated first, then partial slabs, then slabs with every buffer free. The cache's freelist pointer points to the first slab that has a free buffer, and a slab whose count drops to zero moves to the tail. Small objects (under 1/8 of a page) keep slab data at the end of a one-page slab and use free buffers as their own bufctl, large objects get separate slab and bufctl structures and a hash table.
- **Coloring.** Each new slab starts its buffers at a different offset (the color) from the page-aligned base, using the slack at the end of the slab, so hot fields do not all land on the same cache lines.
- **Debugging features.** Auditing logs, freed-memory patterns (`0xdeadbeef`, `0xbaddcafe`), redzones, synchronous unmapping, page-per-buffer mode and a user-level leak detector, enabled without a special kernel.

## Methodology

The measurements compare the new allocator with three others ported into the same SunOS 5.4 base so that only the allocator varies: SunOS 4.1.3 (sequential fit), 4.4BSD (power-of-two segregated storage) and SVr4 (power-of-two buddy system, used in all earlier SunOS 5.x releases). Speed is measured on a SPARCstation-2. Utilization uses a fixed sequence on a 16MB SPARCstation-1: boot, a spike that forks 256 processes each holding a socket, a `find /usr`, and the kenbus timesharing benchmark, with fragmentation read after each step. A week of light desktop use on the author's own 32MB SPARCstation-2 gives a second, uncontrolled data point. System-level gains come from comparing SunOS 5.4 with the SVr4-based allocator it replaced.

## Findings

All figures are the paper's, from Sun hardware of 1994.

- **Stream head.** Allocating and freeing a stream head fell from 33 to 5.7 microseconds. The paper's table lists 23.6 (construction and destruction), 9.4 (memory allocation) and 1.9 (other initialization) for the old allocator, which sums to 34.9, not 33, and 0.0, 3.8 and 1.9 for the new one. The saving is mostly the construction term.
- **Raw speed.** Allocate plus free costs 3.8 microseconds through `kmem_cache_alloc`, 4.7 through `kmem_alloc`, versus 4.1 for 4.4BSD, 9.4 for SVr4 and 25.0 for SunOS 4.1.3. A mutex enter and exit costs 1.0, so locking alone sets a floor of 2.0.
- **Object caching, per allocation type.** Without versus with caching: `allocb` 8.3 to 6.0 (1.4x), `dupb` 13.4 to 8.7 (1.5x), `shalloc` 29.3 to 5.7 (5.1x), `allocq` 40.0 to 10.9 (3.7x), `anonmap_alloc` 16.3 to 10.1 (1.6x), `makepipe` 126.0 to 98.0 (1.3x).
- **Fragmentation.** Total fragmentation after boot, spike, find and kenbus is 11%, 13%, 14%, 14% for slab, against 7%, 19%, 19%, 27% for SunOS 4.1.3, 20%, 43%, 43%, 45% for 4.4BSD and 23%, 45%, 45%, 46% for SVr4. Kenbus scripts per minute: 233, 210, 205, 199. After a week of desktop use the heap is 6.0 MB at 9% for slab, 6.7 MB at 17% for SunOS 4.1.3, 8.5 MB at 35% for SVr4 and 9.0 MB at 38% for 4.4BSD.
- **Hardware cache.** On a SPARCcenter 2000 running LADDIS, replacing the old power-of-two buddy allocator with the slab allocator cut bus imbalance from 43% to 17% and the primary cache miss rate by 13%.
- **System level.** Gains over the SVr4 allocator: DeskBench 12%, kenbus 17%, TPC-B 4%, LADDIS 3%, parallel make 5%, terminal server 5%. The paper attributes DeskBench and kenbus mostly to space efficiency on 16MB, TPC-B to cache effects (5% fewer primary and 2% fewer secondary misses), and the terminal server to a drop in kernel time from 25% to 20%.
- **Fragmentation design.** A 400-byte cache on 4096-byte pages fits 10 buffers with 96 bytes left, 2.4% internal fragmentation. Internal fragmentation is at most 1/n for n buffers per slab, and SunOS 5.4 caps it at 12.5%.

## Critical Analysis

The central argument is well supported inside its scope: the stream head and per-type tables isolate the effect of construction cost, and the other allocators run in the same base kernel. The limits below are the paper's own or follow from its text.

- **Locking stops at the cache.** The design uses one lock per cache and the paper lists per-processor freelists as future work, citing McKenney and Slingwine.
- **Reclaim is lightly evidenced.** Reclaim is triggered only by memory pressure, with a 15-second working set of recent slabs. The paper says measurements show performance "fairly insensitive" to that interval but gives no data.
- **Some gains are bundled.** The 43% to 17% bus result compares the whole slab allocator with a buddy system, so coloring is not measured alone. The one-week desktop test is called "obviously non-controlled" by the author.
- **Not stated by the paper.** It has no ARP or vnode example (its examples are streams, inode, snode, `foo`), no per-CPU caches and no Linux comparison. Its "parallel make" gain is 5%, not labelled as a kernel build. "Severe external fragmentation is unlikely" is argued from design, not measured separately from total waste. The speed table measures the allocator alone.

The following is later literature, not part of the 1994 paper. Bonwick and Adams (USENIX 2001, read) say the original design's global locking did not scale to many CPUs and added a per-CPU magazine layer and the vmem resource allocator, reporting gains above 50% on LADDIS and SPECweb99, and note the slab allocator was adopted in whole or in part by Linux, FreeBSD, NetBSD and others. An LWN article of April 2007 (known only from a fetch summary, not read in full) describes Linux's SLUB as dropping most of SLAB's per-node and per-CPU object queues, keeping per-CPU active slabs and storing slab metadata in `struct page`.

## Further Research

- Per-processor caching on top of slabs: the 2001 magazine layer is the follow-up, and measuring how Linux's SLAB and SLUB differ from the Solaris design on modern many-core machines is a natural comparison.
- How cache coloring behaves on today's physically indexed, highly associative caches, which the paper does not discuss beyond saying hardware trends favored simpler caches.
- Whether constructors help when objects are bound to NUMA nodes or must be zeroed for security.
- Memory pressure beyond a single working-set interval: coordinating reclaim across many caches and with the page cache.

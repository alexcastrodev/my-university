---
title: "WriteGuards: Distributed Storage Support for Strongly Consistent Caches"
summary: WriteGuards let a storage system reject writes that arrive late from a previous owner of a key range, which allows in-process and remote caches built on an auto-sharder to serve linearizable reads from memory without contacting storage.
researchArea: Distributed Systems
keywords: writeguards, linearizable reads, distributed caching, fencing, auto-sharding, delayed writes, tidb
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Many datacenter services need the latest committed state on the request path, for example the current permissions before every call. Reading it from a transactional store costs network round trips and multi-millisecond tails, while caches are fast but usually only eventually consistent. This OSDI 2026 paper, from UC Berkeley, Databricks and ICSI, asks how a cache can return linearizable reads from memory while staying loosely coupled to storage, scaling to billions of keys and surviving resharding.

The obstacle is the delayed-writes anomaly. After an auto-sharder moves a key range to a new pod, a write issued by the previous owner can still be in flight, and if it commits after the new pod has read and cached the old value, the cache is stale. The authors answer with WriteGuards, a small fencing primitive in storage, and build CLink (an in-process cache) and CRink-R and CRink-L (remote caches) on it.

Three terms recur. A slice is a key range that the auto-sharder assigns to a pod. Strong ownership means at most one pod owns a key at a time. The Latest State Invariant (LSI) says a cached value may be served only if it equals the latest committed value in storage.

Worth knowing first: linearizability, leases and fencing tokens, optimistic concurrency control, and range-sharded key-value stores such as [TiDB](/papers/tidb-raft-based-htap-database) (the store the authors modified), [Spanner](/papers/spanner-globally-distributed-database) and [FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store).

## Contribution

- **The WriteGuard primitive.** A tablet server keeps an in-memory interval map from key ranges to opaque guard values. `SetGuard(range, value)` overwrites the guards on a range, and every write carries a guard that must match the one installed for its key. Applications that omit guards match the empty default, so existing clients still work. The map is soft state, cleared on restart.
- **Why existing fixes fall short.** The paper reviews checking versions on every read, turning reads into metadata writes, per-key Chubby sequencers, TrueTime-style timestamp fencing and timeouts. Each costs read latency, needs per-key state, depends on special clock hardware or only lowers the odds of a stale write.
- **CLink.** A write-through cache linked into application pods. On a new assignment, the pod installs a fresh guard over each tablet-sized piece of the slice, and only then caches. Two rules (installs must be ownership-contained and non-overlapping) give the guards a total order that matches their order in storage, and a third (every install uses a fresh value) means a delayed write from a prior owner can never match.
- **Serving rules.** A write evicts the key, and a read result is cached only if it passes the LSI check: a guard was in place, no write overlapped it, and ownership was continuous. Every hit first checks that ownership has not been lost.
- **Hot keys.** The auto-sharder isolates a hot key and can replicate it. A primary takes all writes and runs a two-phase invalidation across replicas, and any change of group membership drops their cached entries.
- **CRink-R and CRink-L.** CRink-R runs the same design as a shared remote service. CRink-L keeps only versions in a small consistent service and values in an ordinary lookaside cache such as Redis: a read fetches both in parallel and falls back to storage if the versions differ.

## Methodology

The cache is about 6,000 lines of C++, and the authors wrote an auto-sharder with strong ownership (about 12,000 lines of Scala) inspired by Centrifuge. For storage they extended TiDB 7.5.1 with SetGuard and the write check, changing 717 lines of Rust in TiKV, 229 lines of Go in the SQL layer and 57 lines of Go in the Placement Driver, which they put at roughly one person-month.

Experiments ran on production clusters with 9 TiKV pods, 6 TiDB pods, 3 PD pods and 6 application pods of 16 vCPUs. Latency is measured from the application server. Workloads are Meta and Twitter traces (simple key-value) and an internal Unity Catalog trace, which is 99.4% reads with values around 23KB and 6 to 8 storage fetches per request. Baselines are direct storage, a version check on every read, and Chrono (Dropbox), configured with its recommended 5 second attempt timestamp. Beyond the three-trace comparison, the authors use only Unity Catalog and synthetic loads.

## Findings

These are the authors' reported results.

- **Per-core throughput.** CLink reads reach about one million operations per second per core and 22.8 million QPS at 24 cores, scaling near linearly. The authors say the prototype is unoptimized and not meant to represent state-of-the-art cache performance.
- **WriteGuard overhead.** Under a write-only load at 75% storage CPU, neither throughput nor latency is adversely affected. SetGuard runs per assignment change, not per write.
- **Read latency (P90).** CLink reaches 0.5 µs to 4.2 µs against 4.8 ms to 10.3 ms for storage and 3.3 ms to 9.0 ms for version checks. CRink-R and CRink-L reach 0.65 ms to 3.2 ms against 2.3 ms to 5.5 ms for Chrono, which the authors state as 3.6x to 5.2x lower than storage and 2.2x to 2.4x lower than Chrono. P99 is left out because it mostly reflects cache misses.
- **Chrono's hit rate.** Its 5 second timestamps keep a written key uncacheable for that long, and the authors compute that more than one write per 50 seconds on a key pushes the hit rate below 90%.
- **Write traffic.** On the Unity Catalog trace with reads converted to writes, CLink latency stays stable as writes grow. On a single hot key, latency rises to 2 ms to 2.8 ms once the hit rate falls below the percentile: P99 at 80 write QPS, P90 and P50 at 200 and 400.
- **Resharding.** With 0.5% traffic churn, CLink stays at 100% availability with low latency because assignments change in under 20 ms. Three production services moved typically under 0.2% of load per minute.
- **Replication.** The auto-sharder adds replicas as read load rises and write latency grows only modestly. The authors lowered pod capacity to trigger 5 replicas, which would normally need over 80 million QPS on one key.
- **Restarts.** Across 86 sharded services, unplanned restarts happen about once in 750 to 2,000 restarts. For a 100-pod service, 1% of keys down for 30 seconds still leaves daily availability above 99.999%.

## Critical Analysis

The paper is open about the costs of its design. It concedes three.

- **Strong ownership costs availability.** After an unplanned crash the old lease must expire, which leaves the range unavailable for tens of seconds. The authors argue this is rare, using fleet restart data.
- **Written hot keys lose the cache.** CLink does not cache a key while a write overlaps it, so a heavily written key is served from storage, and replicas add invalidation latency to writes.
- **Scope and prototype limits.** The paper covers one datacenter, drops guard metadata on tablet migration, leaves the bound on retained guards unexplored, and says its throughput numbers do not reflect an optimized cache.

The following points are a reading of the evidence, not claims of the paper.

- **Correctness is argued in prose.** Section 6.4 argues that values satisfy the LSI on entry and at serve time. I found no mechanized proof, model checking or linearizability test reported, and the argument assumes assignment consistency and the cheap ownership check from the authors' own auto-sharder.
- **Crashes are estimated, not measured.** The resharding experiment covers planned moves. No experiment I read kills a pod and measures the lease-expiry window, so the availability claim rests on fleet statistics.
- **One store.** "Easily added" rests on about 1,000 changed lines in TiDB, whose tablets are already key ranges. WriteGuard overhead comes from one write-only run, and Unity Catalog is an internal trace that others cannot rerun.
- **One baseline for remote caches.** Chrono is compared at its 5 second default, and the gap would shift with another bound, which is not explored. The abstract also folds 2.2x to 2.4x into one claim against storage and remote caches, while the body gives 3.6x to 5.2x against storage.
- **The headline is a P90 on read-heavy traces.** The "three orders of magnitude" compares memory in the application process with a network read. No baseline is an eventually consistent cache, so the price of consistency over a plain in-process cache is not isolated.
- **Some limits are asserted.** Single-key write rates that break CLink "significantly exceed" production rates, but no rates are shown.

## Further Research

- Cross-datacenter caching over global stores, which the paper mentions and leaves out of scope.
- Bounding the guards kept after splits and merges, and moving guard state with migrating tablets.
- The optimizations the paper lists: request gating, versions in the cache, per-key guards after a failed write, and tagging reads with their guard.
- A second store plus crash injection and a linearizability checker, and a comparison with log-based routes to linearizable in-memory reads such as [Tango](/papers/tango-distributed-data-structures-over-a-shared-log), whose views check the log tail before each read.

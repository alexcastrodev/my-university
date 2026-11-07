---
title: "Grove: a Separation-Logic Library for Verifying Distributed Systems"
summary: Grove extends concurrent separation logic with per-node ownership, crashes, lossy networks and time-bounded invariants, so that proofs can cover time-based leases, and its authors use it to verify vKV, a replicated Go key-value store whose replicas serve reads under leases.
researchArea: Distributed Systems
keywords: separation logic, formal verification, leases, crash recovery, reconfiguration, time-bounded invariants, iris
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Verifying a distributed system means handling concurrency, crashes that wipe memory, lost or duplicated messages and loosely synchronized clocks at once. One piece earlier verification work had not handled is the lease, a promise that something will not change for a period of time. Leases interact with crash recovery and reconfiguration (a new primary can only be chosen after leases expire) and with node-local concurrency, because a lease can expire between the check that passes and the read it was meant to protect.

This SOSP 2023 paper (Koblenz), by Upamanyu Sharma, Ralf Jung, Joseph Tassarotti, M. Frans Kaashoek and Nickolai Zeldovich (MIT CSAIL, ETH Zurich and New York University), presents Grove, a library for concurrent separation logic (CSL). It extends Perennial, which is built on Iris and Coq, and is used to verify distributed components written in Go. The headline case study is vKV, a multi-threaded key-value store with primary/backup replication, reconfiguration, crash recovery and lease-based reads on any replica.

Keep three layers apart: Grove is the logic library, vRSM is the verified replicated state machine library built with it, and vKV is a key-value store on top of vRSM. The authors say vKV's design is not novel, it is a case study.

Worth knowing first: Hoare-style pre and postconditions, the idea of ownership in separation logic (`x` points to `v` means this thread owns location `x`), linearizability and primary/backup replication. The paper cites [Spanner](/papers/spanner-globally-distributed-database) as an example of leases that keep a single Paxos leader.

## Contribution

- **Ownership across nodes.** Grove adds per-node heap points-to resources, plus resources for network state and file contents. The separating conjunction then separates state across nodes as well as across threads. Nodes may crash independently at any point, even during recovery, losing their heap but keeping durable files, and Grove extends Crash Hoare Logic to this setting.
- **An unreliable-network model.** Messages can be dropped, reordered or duplicated. A verified `rpc` library gives unreliable calls, and its specification asks for a duplicable precondition, because a request may be retransmitted and each execution consumes one copy. The recurring pattern is to phrase preconditions as knowledge rather than exclusive ownership.
- **Ghost resources.** Epochs come as an exclusive `CurrentEpoch = e` held by the configuration service and a duplicable `CurrentEpoch >= e`, which implies epochs only grow. Logs are append-only lists with three resources: the points-to, a duplicable lower bound, and a read-only version used to model a sealed replica.
- **Time-bounded invariants.** An invariant that holds only until a lease expires, with four rules. It is created by giving up a resource and fixing an expiry, reclaimed after expiry, extended only forward, and opened while it has not expired. Time comes from a TrueTime-like `GetTimeRange()` returning an interval that must contain the true time, with clocks assumed synchronized to within known bounds (under a second for vKV). The proof may take steps at the instant of that call and must consider both outcomes of the check that follows.
- **The case studies.** vKV is assembled from `rpc`, `storage`, `exactlyonce`, `replica`, `reconfig`, a `configservice` and a small Paxos-based replication layer for it. A write commits only after every replica accepted it, and a replica serves reads under an epoch lease from the configuration service. Applications on top include `cachekv` (lease-based client caching), a lock service and a bank.

## Methodology

The proofs are machine-checked in Coq, and the authors confirm completeness with `Print Assumptions`. Grove's own extensions to Perennial are 1,597 lines of Coq, with a distributed composition soundness theorem. Proof effort is reported as Go lines against Coq spec and proof lines for each component (Figure 10), and the text walks through "what if" scenarios showing where a proof would get stuck on a bug.

Performance experiments use 8 CloudLab servers (up to 3 replicas, 4 clients, 1 configuration service), each with a Xeon E5-2630v3, 64GB of RAM, a 200GB SSD and a gigabit NIC. Load is YCSB with uniform keys and 128-byte values from closed-loop clients, with a 20-second warm-up and a 1-minute measurement. The baseline is Redis with `appendfsync always`, against vKV pinned to one core with no backups. Further experiments scale servers and kill the primary of a two-server configuration.

## Findings

These are the authors' reported results.

- **Proof effort.** 2,435 verified lines of Go need 28,077 lines of Coq spec and proof, about 12×, with 170 more lines of trusted network and file system libraries. The authors call this comparable to concurrent and distributed verification projects, slightly above IronFleet (which also proves liveness) and slightly below GoJournal. The `replica` component needs 8,093 proof lines for 578 of code.
- **Small top-level specs.** The bank's specification is 52 lines and vKV's is 49, in four parts: crash-idempotent `main()`, a safe `Reconfigure`, a correct `MakeClerk`, and linearizable `Put`, `Get` and `CondPut`. The bank proof uses only these specifications.
- **Bugs ruled out.** The proofs explain why an old primary cannot commit after being sealed, why uncommitted operations in a log are safe to commit later, why a long pause after the lease check (garbage collection, say) cannot break a read, why a `Put` cannot change a cached value, and why `GetAndCache` cannot shorten a lease.
- **Against Redis.** On one core, vKV reaches 67,360, 75,174 and 87,634 requests per second at 100%, 50% and 5% writes, against 99,066, 107,028 and 118,594 for Redis, which the authors summarize as 67 to 73% of Redis. Read latency under low load is 126 µs against 81 µs, write latency 603 µs against 538 µs. The mean is over 10 runs, with a standard deviation of 1 to 2% for Redis and 7 to 11% for vKV. On 8 cores vKV reaches 5.1× its single-core throughput at 5% writes.
- **Replicas.** With 5% writes, 3 servers give 1.7× the throughput of one, and with 0% writes 2.3×. The introduction gives 463,491 and 816,252 requests per second for a 95%-read workload on 1 and 3 servers. With 50% and 100% writes, more replicas lower throughput, since writes cost more at the primary and few reads are offloaded.
- **Reconfiguration.** After the primary is killed at 10 seconds, reads continue on the backup. Throughput dips, partly recovers, then declines again as reads of keys with in-flight writes get stuck until the new configuration starts. The whole reconfiguration, copying 1M pairs of 128 bytes, takes about 4 seconds, mostly marshalling and sending the state.
- **Adding leases later.** The first vRSM and vKV had no leases, so every `Get` was replicated. The replication and reconfiguration proofs stayed the same, and a new proof on top shows owning the current epoch means a replica is at least as current as the committed operations.

## Critical Analysis

The paper is open about what Grove does not cover.

- **Safety only.** Grove cannot verify liveness, so nothing proves a client gets a response or that reconfiguration finishes. The logic that decides when to reconfigure is not shown and safety is independent of it, and writes block while any backup is unavailable.
- **Reference baseline.** The authors note Redis targets other goals (one core, no synchronous replication, no live reconfiguration, no exactly-once) and that vKV stores a 16-byte request ID per operation. The single-core variance for vKV is attributed to the Go runtime.
- **Expert-level machinery.** Several components are only in the extended version, and the lower-level techniques are offered to Iris experts.

The following points are a reading of the evidence, not claims of the paper.

- **Failure behavior is measured once.** The reconfiguration experiment is one crash, one two-server configuration and one state size. The time is dominated by moving all the state, so it probably grows with data size, but no other size is tested and no other system is compared.
- **Abstract and body differ slightly.** The abstract says about 2× going from 1 to 3 servers, the body gives 1.7× and 2.3× depending on the write ratio, and the introduction's figures give about 1.76×. The body figures are used here. Likewise, the ratios in Figure 11 compute to roughly 68% to 74%, against the stated 67 to 73%, a small rounding difference.
- **Scale is small.** Scaling stops at 3 servers, and keys are uniform with 128-byte values, so skewed workloads, larger clusters and bigger values are untested. All-replica commit means the write path cannot improve with replicas.
- **Leases are shown indirectly.** The text says leases matter for read performance, but Figure 13 shows scaling with servers, not vKV with and without leases, although a lease-free version existed. `cachekv`, the lock service and the bank are proven but not measured.
- **Proof effort is lines, not time.** The 12× ratio compares lines across Dafny, Go and Coq projects that prove different properties, as the authors partly note. Person-time, proof-checking time and the effort of the lease change are not reported.
- **Bug-finding is by argument.** The "what if" scenarios explain where a proof would stall, but no injected bugs or bugs found in unverified versions are reported, so "eliminates broad classes of bugs" rests on reasoning.
- **The model carries weight.** Guarantees hold under the execution model: clocks within known bounds, durable files surviving crashes, trusted network and file system code. The text does not say how those assumptions were checked against real clocks or `fsync` behavior, and the model has no disk corruption or malicious nodes.

## Further Research

- Liveness reasoning, which Grove cannot do today, perhaps for the failure detector and reconfiguration policy that vKV leaves outside the proof.
- Reusing time-bounded invariants for other lease protocols, for example the roster leases of [Bodega](/papers/bodega-localized-linearizable-reads-with-roster-leases), whose assurance is a concise proof and a TLA+ specification (a pairing of mine, the paper predates Bodega).
- A reconfiguration that does not move all state through one replica, with measurements across state sizes and repeated failures.
- Validating the model against real systems (clock error, `fsync`, disk faults) and reporting proof effort in time, so the cost can be compared with tools such as [Verus](/papers/verus-practical-foundation-for-systems-verification), which the paper does not cite but whose VerusSync borrows resource algebras from CSL, and with [RustBelt](/papers/rustbelt-securing-foundations-of-rust), another proof built on Iris.

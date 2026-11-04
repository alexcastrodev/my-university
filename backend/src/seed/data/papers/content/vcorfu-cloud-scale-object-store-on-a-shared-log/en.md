---
title: "vCorfu: A Cloud-Scale Object Store on a Shared Log"
summary: vCorfu is a strongly consistent object store that writes each update to a global log replica and to a per-object stream replica, so that servers can answer reads without client playback, and that splits huge objects into smaller state machines through composable state machine replication.
researchArea: Distributed Systems
keywords: shared log, state machine replication, materialized streams, object store, optimistic transactions, sequencer, opacity
version: 1.0
updatedAt: 2026-11-03
---

## Overview

A shared log turns a distributed store into one sequence of appends: every update gets a position in a total order, and clients rebuild state by reading it. [Corfu](/papers/corfu-shared-log-design-for-flash-clusters) and [Tango](/papers/tango-distributed-data-structures-over-a-shared-log) use this design for strong consistency and cheap global snapshots. This NSDI 2017 paper starts from its weakness, which the authors call playback: before answering a request, a client must read and apply updates, including ones the request does not depend on. According to the paper, this has limited shared logs to settings with few clients or small global state, such as metadata services.

vCorfu keeps the global log and adds a second copy of each update, organized by object, so that a server holding one object's full history can do the playback and answer directly.

Worth knowing first: state machine replication, the off-path sequencer of Corfu, optimistic concurrency control, and opacity, which ensures that transactions never observe inconsistent state.

## Contribution

- **Materialized streams.** Each object maps to a stream, and each update goes to a log replica indexed by global address and to a stream replica indexed by stream id and stream address. A stream thus supports random and bulk reads, unlike Tango streams, which the paper describes as "merely tags within a shared log" linked by backpointers.
- **Remote views.** A client can keep an object's state in its own memory (a local view) or let the stream replica hold the state and apply updates (a remote view).
- **A sequencer that resolves transactions.** Tokens are issued conditionally: if the affected streams changed since the transaction's snapshot, the client aborts without writing, so the log holds only committed transactions.
- **Composable state machine replication (CSMR).** Objects are built from other objects, such as a map from child maps acting as buckets, or a B-tree from node objects, with references that follow the latest version or the version of a snapshot.

## Methodology

The paper describes the design and evaluates a Java implementation on sixteen 12-core machines with 10G NICs on one switch. All benchmarks run in memory with persistence disabled, and the authors report that Java and serialization overheads left the system CPU-bound.

To isolate materialization, they built a variant with backpointers and chain replication, similar to Tango, and compared the two with 32-byte entries. They ran YCSB with 1 KB entries against Cassandra 2.1.9: vCorfu used a CSMR map on 12 replicas with chain length 2, and Cassandra used 12 nodes, replication factor 2, consistency level ALL and durable writes off. Transactions were tested with snapshot reads, a two-phase locking baseline built from Cassandra and a single-node ZooKeeper, and a simulated advertising analytics workload. CSMR was compared with a plain SMR map under uniform and Zipf keys.

## Findings

These are the authors' reported results.

- **Materialization costs writes.** The commit message imposes about a 40% write penalty against the backpointer protocol. Write throughput still grew with replicas, and the authors place the bottleneck in both schemes at the sequencer's token rate.
- **Holes are costly for backpointers.** After a hole, the median time to read a stream in that variant was 210 ms with 32 streams, 14.8 s with 100K and 39.6 s with 500K.
- **Remote views address playback.** With local views, read latency passed one second at 32 clients. With a remote view, the paper reports maintained read throughput and millisecond latency with 1K clients.
- **YCSB.** Write performance was comparable to Cassandra. Cassandra degraded on most read-dominated workloads because it must read both replicas to avoid stale data.
- **Read-only transactions do not conflict.** Remote views sustained nearly 10K snapshot transactions per second. In the locking baseline, the writer's abort rate reached 92% at 200 readers, while vCorfu's writer throughput stayed constant.
- **CSMR.** Opening a view over 100 MB of updates took nearly 10 s for the SMR map and at most 70 ms for CSMR maps. Transactions on the SMR map aborted half the time with two writers, against 2% with 1000 buckets and 16 writers. Whole-object operations are the cost: a clear plus a size could approach 30 s when playback was needed for all buckets.

## Critical Analysis

The paper shows a concrete way to combine a global order with per-object locality, but the evidence is narrower than the headline.

- **The Cassandra result is one configuration.** The abstract says vCorfu outperforms Cassandra, yet writes are only comparable, so the advantage is in reads and comes largely from the read of both replicas that consistency level ALL requires. vCorfu also got a special `fastPut()` path for the benchmark.
- **Nothing is persisted.** Persistence is off on both sides, which keeps the comparison even, but the numbers describe in-memory protocols and CPU limits, not a store writing to stable media.
- **The sequencer stays central.** The authors place the write bottleneck there, and it now also checks transactions, yet the paper reports no token rate. The [FuzzyLog paper](/papers/fuzzylog-partially-ordered-shared-log) later named vCorfu among the systems whose sequencer becomes "a centralized point of coordination", although its experiment emulates Tango's protocol, not vCorfu's.
- **Conflicts are detected per object.** The paper admits that finer detection would need client resolution or a heavier sequencer. Two updates to different keys of one map therefore conflict, so part of CSMR's abort reduction repairs this limit.
- **CSMR is measured on maps only.** The B-tree and its escape from the recursive update problem are described, not evaluated. The bucket count is fixed at creation, and resizing is not discussed.
- **Failure testing is partial.** Only a stream replica failure under local views is measured. The paper admits a remote view would have to read the entire stream, and remote views carry the best read results.
- **The locking baseline is the authors' own.** One writer and a single-node lock service show how readers hurt a simple scheme, not how a tuned transactional system behaves.
- **Two numbers disagree.** The Figure 9 caption gives a 50% chance of scanning 10k entries at 500k streams, while 39.6 s at the stated 0.3 ms per entry implies around 130K entries.

## Further Research

- How much of the read and write advantage survives with persistence enabled.
- Whether token issuance and conditional checks can scale past one sequencer while keeping global snapshots.
- Conflict detection finer than one object, without client-side resolution or a heavyweight sequencer.
- Resizing CSMR objects while in use, and measuring CSMR trees against the recursive update claim.
- The cost of restoring remote views and rebuilding replicas after failures.

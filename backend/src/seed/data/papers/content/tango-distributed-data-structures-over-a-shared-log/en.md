---
title: "Tango: Distributed Data Structures over a Shared Log"
summary: Tango gives developers in-memory data structures whose state is a history in a shared log, so replicas get linearizability, durability and transactions across objects from appends and reads, while streams let each client play only the part of the log it needs.
researchArea: Distributed Systems
keywords: shared log, metadata services, state machine replication, optimistic concurrency control, distributed transactions, streams, CORFU
version: 1.0
updatedAt: 2026-11-03
---

## Overview

Metadata usually lives in maps, trees, counters and queues, and updating it often means changing several structures atomically, such as moving a node from a free list to an allocation table. This SOSP 2013 paper lists the usual ways to make such a service highly available: a custom protocol, a rewrite as a state machine over Paxos, or an existing service such as ZooKeeper, which imposes one data structure.

Tango offers another way. An object exists as a history of updates in a shared log and as any number of views, the conventional data structure in RAM on application servers. As the paper puts it, "the shared log is the object", and views are soft state rebuilt by playing the log. Tango runtimes on different machines never message each other.

The log comes from [CORFU](/papers/corfu-shared-log-design-for-flash-clusters), run in modified form. CORFU supplies appends, reads and a centralized sequencer, whose speed sets the log's append limit; Tango adds the object model, transactions and streams. The paper places this beside Percolator, [Spanner](/papers/spanner-globally-distributed-database) and [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) as a source of global ordering for sharded state.

Worth knowing first: state machine replication, optimistic concurrency control, sharding, and the CORFU calls append, check, read and trim.

## Contribution

- **The Tango object.** A view, an apply upcall that alone may change it, and methods built on two runtime helpers: one appends an update, the other plays the log to the tail before a read.
- **Properties taken from the log.** Linearizable reads come from checking the tail and catching up, durability from replay, rollback from playing a prefix and read scaling from adding views.
- **Transactions as log records.** A commit record lists the versions read, and every client that reaches it decides commit or abort independently but deterministically. The paper claims the isolation of 2-phase locking, identical to that of Spanner.
- **Streams and layered partitioning.** Each object gets a stream, and `readnext` skips entries from other streams. A `multiappend` places one entry on several streams, so a transaction across objects keeps a single commit record. Entries carry backpointers to earlier entries of their stream, which the sequencer now tracks.
- **Decision records.** A client that hosts a written object but not the read set cannot judge the transaction, so the generating client appends the outcome.

## Methodology

The testbed has 36 8-core machines in two racks with gigabit NICs. Eighteen run CORFU on Intel X25V SSDs as 9 mirrored pairs across racks, the other 18 are clients generating load locally, and the sequencer has its own 32-core machine. Entries are 4KB and each client batches 4 commit records per entry.

Experiments run TangoRegister with one, two and N views, then TangoMap transactions of three reads and three writes under uniform and zipf keys. Cross-partition transactions read locally and write locally and remotely, compared against a simple distributed 2-phase locking protocol, resembling Percolator's, built into `EndTX`. ZooKeeper and BookKeeper implementations are tested under the HDFS namenode.

## Findings

These are the authors' reported results, from Tango on its modified CORFU, apart from the stand-alone sequencer benchmark, which the paper reports in its CORFU background.

- With 18 clients, 180K linearizable reads per second run against 10K writes per second.
- On one fully replicated map, throughput peaks at three nodes and stays flat, the playback bottleneck. At 3 nodes, goodput is low with tens or hundreds of keys and from 10K keys reaches 99% of throughput under uniform selection and 70% under zipf.
- With one map per client, a 6-server log saturates at around 150K transactions per second, and an 18-server log reaches 200K without hitting its ceiling.
- Over 100K transactions per second are sustained when 16% span objects on different clients. Tango and 2PL both degrade gracefully, with goodput around 99%. When transactions read and write a shared object instead, throughput falls sharply going from 0% to 1% while goodput stays at 98% to 99%.
- The ZooKeeper version takes under 1,000 lines of Java against over 13K for the original, and the BookKeeper version around 300.
- A rewritten CORFU sequencer plateaus at around 570K requests per second without batching, and a failed one is replaced within 10 ms on 18 nodes.

## Critical Analysis

The paper's strength is how much it extracts from one primitive. The evidence has clear limits.

Limits the paper states itself:

- **Global order has a price.** There is "a cap on aggregate throughput across all partitions" once the log saturates.
- **Transactions are restricted.** A client cannot run transactions with remote reads, an entry reaches only a fixed number of streams, and developers mark decision records by hand, a scheme the authors call "simple but conservative and static".
- **Backpointers bind the design to one sequencer.** Section 2 describes it as a removable optimization, but with backpointers "we can no longer tolerate the existence of multiple sequencers". A new sequencer rebuilds its state by scanning the log, and the paper gives no duration for that rebuild.

Points that follow from reading the evaluation:

- **180K is offered load.** It is 18 views at 10K reads each, so it shows no slowdown at that load, not the capacity of the log.
- **Transactions per second are not appends per second.** With 4 commit records per entry, these figures cannot be set against the appends per second of the CORFU paper, which also used another cluster and sequencer.
- **The 10 ms replacement figure appears to exclude the rebuild.** The paper gives the figure for replacing a failed sequencer and only then describes the rebuild, so a full recovery probably takes longer.
- **Contention decides goodput, not the whole cost.** The 99% goodput figures in the partitioned experiments use uniform keys over 100K-key maps. Elsewhere contention costs far more: 70% under zipf on one map, and low goodput with few keys. The shared-object case loses throughput with goodput near 99%, so that loss is not contention.
- **The 2PL comparison is partial.** The baseline is a simple protocol built inside Tango, and cross-partition runs read only local data. The claim of "none of the fault-tolerance problems endemic to such protocols" is an argument: no failure is injected there, and Tango has its own time-outs, such as 100 ms by default before filling a hole.
- **Failure behavior is barely measured.** Stalls from holes and view rebuild time go unreported.
- **"Full fidelity" is a narrow claim.** Line counts exclude exceptions and callback interfaces, the ZooKeeper line count leaves out ACL support, the HDFS test is functional, and no performance number is set against the original systems.

## Further Research

- Transactions with remote reads at the generating client, which the authors plan to explore through a collaborative protocol.
- Faster sequencer recovery, for which the authors plan periodic checkpoints in the log.
- How to keep transactions across several logs once one log saturates, without losing the simplicity argued here.
- Measurements under failure and under skew at larger scale.

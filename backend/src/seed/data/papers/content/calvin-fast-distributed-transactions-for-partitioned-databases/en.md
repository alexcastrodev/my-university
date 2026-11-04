---
title: "Calvin: Fast Distributed Transactions for Partitioned Database Systems"
summary: Calvin is a scheduling and replication layer over a non-transactional store that agrees on a global order of transactions before any lock is taken, which removes distributed commit protocols and lets multi-partition ACID transactions scale out on commodity machines.
researchArea: Distributed Systems
keywords: deterministic databases, distributed transactions, two-phase commit, deterministic locking, replication, paxos, tpc-c
version: 1.0
updatedAt: 2026-11-03
---

## Overview

Two-phase commit is expensive mainly because of what it does to locks. A transaction must hold its locks through several network round trips, and on popular records that extra time hurts throughput. The authors, from Yale, call the total time a transaction holds its locks its contention footprint, and many systems of the period avoided the problem by dropping or limiting transactions.

This SIGMOD 2012 paper moves the agreement. Machines agree on what to do "outside of transactional boundaries", before they take locks. All nodes agree on which transactions to attempt and in what order, and every replica executes that plan deterministically. A node failure no longer has to abort a transaction, because a replica can finish it, and logic that may abort deterministically needs only one-way messages. So the commit protocol can go. Calvin also drops two restrictions of the group's earlier work: a single-node sequencer and data entirely in main memory.

Worth knowing first: two-phase locking, two-phase commit, Paxos, and serial equivalence. A footnote makes clear that "high availability" here means failing over to an active replica, not the CAP theorem's sense.

## Contribution

- **Three layers.** A sequencer fixes the global order and replicates it, a scheduler runs transactions with deterministic locking, and storage is any engine with a CRUD interface.
- **A distributed sequencer.** Every machine collects requests into 10 ms epochs and replicates its batch. Each scheduler then builds the global order by interleaving all sequencers' batches in a deterministic round-robin.
- **Replication of inputs.** Inputs, not effects, are replicated asynchronously from a master replica or synchronously with Paxos, through ZooKeeper.
- **Deterministic locking.** A single thread requests each transaction's locks in the global order, and locks are granted strictly in request order. Transactions must therefore declare their full read and write sets in advance.
- **OLLP.** A transaction that must read to learn its read and write sets is preceded by a reconnaissance query, and is restarted deterministically if those sets have changed.
- **Prefetching and checkpointing.** The sequencer delays a transaction that may touch disk while its records are warmed up. A variant of Zig-Zag checkpoints at a point in the global order without quiescing the database, and logging inputs replaces physical REDO logging.

## Methodology

Experiments ran on Amazon EC2, up to 100 nodes. The TPC-C implementation runs only New Order transactions, with 10 warehouses per partition. About 10% of them access a second warehouse, always on another machine. A microbenchmark uses a contention index, the fraction of hot records each transaction updates at a machine.

Replication modes were compared at 10,000 transactions per second per node, 10% multipartition, with three replicas of 4 machines. Disk behavior was tested at 10,000 transactions per second per machine, with a simple filesystem engine and with an engine that simulates storage delay using memory on another machine. No traditional system was run: the two-phase commit line in the high-contention experiment comes from a simple model, with throughput capped at 1 / (C * D), where C is the contention index and D is an expected lock hold of about 8 ms, assuming a baseline of 27,000 transactions per second per machine.

## Findings

These are the authors' reported results.

- **TPC-C New Order.** Around 5,000 transactions per second per node in clusters larger than 10 nodes, and nearly half a million on 100 nodes. The authors set this beside Oracle's record of 504,161 New Order transactions per second on much higher-end hardware.
- **Scaling shape.** Per-node throughput drops sharply from one machine to two, because of the CPU cost of multipartition work. It then flattens by around 10 machines at contention index 0.0001 and declines more gradually at 0.01, which the authors attribute to execution progress skew: a machine may have to wait for another to catch up.
- **Multipartition cost.** With 100% multipartition transactions at low contention, the microbenchmark falls from 27,000 to about 5,000 (4 nodes) or 4,000 (8 nodes) transactions per second, a slowdown of about 5x to 7x.
- **High contention.** At very high contention the two-phase commit model slows down significantly more than Calvin, even though it ignores several costs. The authors read this as evidence that the commit protocol is a major obstacle to ACID support and that Calvin alleviates it.
- **Replication.** Total throughput was not affected by the replication mode, including Paxos across three regions with 100 to 170 ms of ping time.
- **Disk.** With the filesystem engine, throughput held as long as no more than 0.9% of transactions touched disk, a limit the authors attribute to low-end disks. At contention index 0.01 this took an artificial delay of 40 ms. The simulated engine held 10,000 transactions per second per machine however many touched cold data.

## Critical Analysis

The core argument is strong: holding locks during agreement is costly under contention, and agreement can happen earlier. The evidence is narrower than the headline claims.

The paper states several limits itself. Range locks and phantom protection are future work. Determinism forbids reordering, so a stalled transaction blocks conflicting successors. Tracking which keys are in memory across all nodes "is not a scalable solution". After a crash, throughput in the rest of the replica "is apt to slow or halt" until recovery ends. The authors call the 2PC model "somewhat naïve", and present it as a lower bound on a rival's slowdown.

The rest is a reading of the evidence, not a statement by the authors.

- **The 2PC comparison is arithmetic.** The paper announces "a detailed comparison to a traditional system", but no such system ran. The formula gives 125 transactions per second at C = 1, a result that rests on the 8 ms and 27,000 inputs.
- **Removing 2PC does not make multipartition work cheap.** Calvin's own 5x to 7x slowdown appears at low contention, and the paper ties it to the CPU cost of multipartition work and to skew.
- **The TPC-C match is partial.** Calvin ran one transaction type, and "similar performance" on the full benchmark is an expectation, so the comparison with a published record spans different workloads. This also leaves OLLP unmeasured: the paper's example, TPC-C Payment, is not in the workload, and restart rates are argued from how rarely indexed fields change.
- **"No cost" was tested at one load.** Replication modes were compared at a fixed 10,000 transactions per second per node, and the text does not say how close that rate is to peak. Section 6 does not state a replication mode for the scaling runs, so scale and geo-replication are not shown together. Latency is the admitted price.
- **Failure handling is argued, not measured.** The evaluation reports no failover or recovery time, so having no single point of failure is a property of the design, not a measured result.
- **Slow sequencers are not evaluated.** The paper documents execution skew, not the effect of a slow sequencer on the round-robin. The later [Scalog paper](/papers/scalog-seamless-reconfiguration-and-total-order) describes its own interleaving as a generalization of this idea that is not sensitive to slow servers. That claim is Scalog's, not Calvin's.

## Further Research

- Open points the paper names: range locking through virtual resources, delaying multipartition transactions without global key tracking, the tradeoff between latency and contention when predicting disk latency, and more seamless failover.
- A head-to-head experiment against a real, well-tuned two-phase commit system.
- The full TPC-C mix, with OLLP restart rates measured under workloads where the indexed fields do change.
- Scale and Paxos replication across regions measured together, at saturation, with failures injected.

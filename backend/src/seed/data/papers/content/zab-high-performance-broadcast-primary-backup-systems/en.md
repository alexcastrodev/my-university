---
title: "Zab: High-performance Broadcast for Primary-Backup Systems"
summary: Zab is the crash-recovery atomic broadcast protocol of ZooKeeper. It replaces Paxos-style independent instances with an epoch-based leader that runs discovery, synchronization and broadcast phases, so a primary can keep many incremental state changes in flight and the delivered order still respects the order of primaries.
researchArea: Distributed Systems
keywords: zab, atomic broadcast, primary-backup, zookeeper, primary order, crash recovery, epochs, quorum
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Zab is a crash-recovery atomic broadcast algorithm we designed for the ZooKeeper coordination service. ZooKeeper implements a primary-backup scheme in which a primary process executes client operations and uses Zab to propagate the corresponding incremental state changes to backup processes. Due to the dependence of an incremental state change on the sequence of changes previously generated, Zab must guarantee that if it delivers a given state change, then all other changes it depends upon must be delivered first. Since primaries may crash, Zab must satisfy this requirement despite crashes of primaries.

Applications using ZooKeeper demand high performance from the service, and consequently, one important goal is the ability of having multiple outstanding client operations at a time. Zab enables multiple outstanding state changes by guaranteeing that at most one primary is able to broadcast state changes and have them incorporated into the state, and by using a synchronization phase while establishing a new primary. Before this synchronization phase completes, a new primary does not broadcast new state changes. Finally, Zab uses an identification scheme for state changes that enables a process to easily identify missing changes. This feature is key for efficient recovery.

Experiments and experience so far in production show that our design enables an implementation that meets the performance requirements of our applications. Our implementation of Zab can achieve tens of thousands of broadcasts per second, which is sufficient for demanding systems such as our Web-scale applications.

## Overview

ZooKeeper, described in [ZooKeeper: Wait-free Coordination](/papers/zookeeper-wait-free-coordination-internet-scale-systems), keeps replicas consistent with a primary-backup scheme: one primary executes each client request and turns it into a non-commutative, incremental state change, called a transaction, that it sends to the backups. This paper, from Yahoo! Research and published at DSN 2011, is the specification and description of the protocol that carries those transactions. The authors note that earlier systems such as [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) and [Paxos Made Live](/papers/paxos-made-live-engineering-perspective) were designed for long-lived and infrequent state changes, while ZooKeeper had to serve applications that use it extensively.

The motivating problem is that each state change is computed against the state produced by the previous one. If the change from A to B is delivered after some unrelated change C has taken B's place in the sequence, the replicas apply B to a state it was not computed from. The paper shows a run of Paxos, with one instance per sequence number, in which this happens when several proposals are outstanding. A known remedy, batching many transactions into one proposal with at most one proposal outstanding, hurts throughput or latency depending on the batch size.

Worth knowing first: Paxos as in [Paxos Made Simple](/papers/paxos-made-simple), the replicated state machine idea behind [the state machine approach](/papers/state-machine-approach-fault-tolerant-services-tutorial), quorums, and the happens-before relation of [Lamport's clocks paper](/papers/lamport-time-clocks-ordering-of-events).

## Contribution

- **A new correctness property, primary order.** It has two parts, local primary order (FIFO order for one primary) and global primary order (transactions of an earlier primary come before those of a later one), plus primary integrity, which forces a new primary to deliver what earlier primaries produced before it broadcasts.
- **PO atomic broadcast.** The authors call Zab a PO atomic broadcast protocol, and state agreement as a safety property instead of the liveness property used in earlier work.
- **Three phases.** Zab runs discovery, synchronization and broadcast, with an extra synchronization phase compared to Paxos.
- **Transaction identifiers.** A zxid is a pair of an epoch and a counter, ordered first by epoch and then by counter, so each identifier maps to at most one transaction and processes accept them in order.
- **An implementation.** The protocol is in production as part of ZooKeeper, with a benchmark on a 13-server cluster.

## Methodology

The system model is a set of processes with stable storage that can crash and recover an unbounded number of times, with a quorum system whose quorums pairwise intersect. Channels satisfy integrity, prefix and single iteration properties, which the implementation obtains by opening a TCP connection at the start of each iteration. Progress needs a quorum of processes that are up and can exchange messages for long enough. The paper assumes an external mechanism that guarantees at most one active primary at a time, and in the implementation that mechanism is tightly coupled with the broadcast layer.

The protocol is given as steps for a leader and its followers. Section VI gives invariants and proof sketches for each safety property and for one liveness claim, and points to the technical report "Dissecting Zab" (Yahoo! Research, YL-2010-007) for the detailed proof. Section VII measures the Java implementation with a special benchmark wrapper that talks to Zab directly: the leader generates batches of 250,000 requests and keeps 1,000 outstanding, with warm-up batches and about 10 timed batches, on 1024-byte operations. The cluster has up to 13 servers with dual quad-core Xeon 2.50GHz CPUs, 16G of RAM, a gigabit interface and a dedicated 1T SATA disk for the proposal history, running RHEL 5 and Sun's JVM 1.6.

## Findings

**The three phases.** Each process runs one iteration at a time and can drop it to restart at Phase 1.
- **Phase 1, discovery.** Followers send CEPOCH with their last promise. After a quorum answers, the prospective leader proposes NEWEPOCH with an epoch later than any received. Followers that accept reply ACK-E with their current epoch and history, and the leader picks the history of the follower with the latest epoch and, on a tie, the highest zxid as the initial history.
- **Phase 2, synchronization.** The leader sends NEWLEADER with the new epoch and initial history, followers accept it, and after acknowledgements from a quorum the leader commits and is established. Followers then deliver the initial history, and only after that may the primary call ready(e) and broadcast.
- **Phase 3, broadcast.** The leader proposes transactions in increasing zxid order, commits after a quorum acknowledges, and followers deliver in zxid order. The paper describes this as similar in spirit to two-phase commit without aborts.

**Ordering and causality.**
- Zab does not satisfy classic causal order. The paper's Figure 3 shows an execution where a transaction is never delivered although later causally related ones are.
- Zab satisfies a weaker PO causal order, defined by a PO-precedence relation under which events of different primaries are not necessarily related even on the same process, and a property called strict causality.
- The paper's Figure 4 shows an execution with causal order but without strict causality, and concludes that neither primitive is stronger than the other.

**Differences from Paxos.**
- Zab adds the synchronization phase. Paxos has a read phase and a write phase, which correspond to discovery and Zab's broadcast, and in Paxos the new leader chooses a value for each sequence number independently.
- In Zab the new leader picks one history, the highest zxid among followers with the latest epoch, and replicates it. Recovery then compares last zxids instead of running Paxos Phase 1 for every earlier sequence number.
- The paper says Zab follows Lampson's abstract description of Paxos, with the right to propose in an epoch given to exactly one leader, and that Vertical Paxos still lets one instance receive several values.

**Measurements.** Throughput and latency come from Figures 6 and 7, and the numbers below are read from the charts.
- With a disk write cache or a battery-backed cache, network-only and network-plus-disk throughput are almost identical and saturate the network, falling from roughly 38,000 operations per second with 3 servers to roughly 8,000 with 13.
- With the write cache off, Zab is I/O bound at roughly 13,000 operations per second, almost constant until about 7 servers.
- Average latency for a single 1K operation is about 4 to 5 ms with the network only, about 6 to 7 ms with disk, and about 45 to 67 ms with the write cache off. Ping latency was 100 microseconds.

## Critical Analysis

- **Recovery is claimed, not measured.** Efficient recovery is a headline goal, but the evaluation covers only throughput and latency of a benchmark wrapper. There is no measurement of election or recovery time and no head-to-head comparison with a Paxos implementation.
- **Correctness is argued by sketches.** The full proofs live in a technical report, and liveness is deliberately left thin: the paper says a thorough comparison with Malkhi et al. is out of scope.
- **The Paxos criticism is use-case specific.** Figure 1 targets one setting: incremental, order-dependent state changes with several outstanding proposals and no batching. The paper itself names batching as a known fix and judges its cost, so the result is not that Paxos is incorrect.
- **Strong assumptions in the model.** A static ensemble and an external guarantee of at most one active primary, plus a protocol whose election is tied to the broadcast layer in the implementation.
- **Hardware dates the numbers.** RHEL 5, ext3, a SATA disk and Sun JVM 1.6 are from 2011, and the write-cache result shows how much one disk setting moves the curve. Treat the absolute figures as historical.
- **Later literature, not from this paper.** The Raft paper (extended version, checked) cites this paper and says ZooKeeper's algorithm "has been published in more detail, but it is quite different from Paxos", and also names a strong leader as the greatest difference between [Raft](/papers/raft-understandable-consensus-algorithm) and Paxos. A detailed three-way comparison of Paxos, Zab and Raft is beyond what was checked for this note.

## Further Research

- A liveness analysis with weaker assumptions, the open item the paper leaves.
- Reducing leader network load, since the paper mentions broadcast trees or [chain replication](/papers/chain-replication-high-throughput-availability) and did not explore them.
- Election primitives that return the process with the latest epoch and highest zxid, which the paper suggests would provide the initial history directly.
- Reconfiguration of the ensemble, since Zab assumes a static set of processes.
- Machine-checked proofs of the primary order properties.

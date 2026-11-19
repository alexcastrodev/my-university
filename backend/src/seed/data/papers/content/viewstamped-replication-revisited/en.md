---
title: "Viewstamped Replication Revisited"
summary: Liskov and Cowling restate Viewstamped Replication as a self-contained protocol for crash-fault-tolerant state machine replication, with normal operation, view changes, diskless recovery, optimizations and a reconfiguration protocol that can change the group and its failure threshold.
researchArea: Distributed Systems
keywords: viewstamped replication, state machine replication, view change, primary-backup, crash recovery, reconfiguration, quorums
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

This paper presents an updated version of Viewstamped Replication, a replication technique that handles failures in which nodes crash. It describes how client requests are handled, how the group reorganizes when a replica fails, and how a failed replica is able to rejoin the group. The paper also describes a number of important optimizations and presents a protocol for handling reconfigurations that can change both the group membership and the number of failures the group is able to handle.

## Overview

Viewstamped Replication (VR) was first described by Brian Oki and Barbara Liskov in 1988, at about the same time as Paxos ([The Part-Time Parliament](/papers/paxos-part-time-parliament)) but without knowledge of it. This 2012 MIT technical report (MIT-CSAIL-TR-2012-021) rewrites it for a new generation of readers. The original papers explained VR inside a database and a file system, which made it hard to separate the protocol from its application; here it is presented on its own, in an asynchronous network where nodes fail only by crashing.

The authors stress that VR is a replication protocol, not a consensus protocol: it uses consensus, with a protocol very similar to Paxos, as part of supporting a replicated state machine, the approach described in [Implementing Fault-Tolerant Services Using the State Machine Approach](/papers/state-machine-approach-fault-tolerant-services-tutorial). Compare it with [Paxos Made Simple](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm), which describe the same family of leader-based protocols from other angles. The paper also credits later work on Byzantine fault tolerance (see [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance)) for several of its improvements.

Worth knowing first: state machine replication (replicas that start in the same state and run the same deterministic operations in the same order stay identical), majority quorums, and the asynchronous model, in which the silence of a node says nothing about whether it has failed. As background, the impossibility result in [FLP](/papers/flp-impossibility-of-distributed-consensus) explains why such protocols rely on timeouts, and why a view change can start unnecessarily.

## Contribution

- **A protocol separated from its application.** VR with 2f + 1 replicas tolerates f crash failures. A primary orders client requests, and backups accept its order.
- **Three sub-protocols.** Normal case processing, view changes to choose a new primary, and recovery of a replica that crashed.
- **No disk on the critical path.** The protocol does not require disk writes during request processing or even during view changes. Persistence comes from replicated state: the volatile state at f + 1 replicas is used as stable state.
- **A reconfiguration protocol.** A special request moves the system to a new epoch with a new group, which can change membership and also the threshold f.
- **Practical machinery.** Checkpoints with Merkle trees for state transfer, witnesses, batching and two ways of making reads fast.

## Methodology

The report is a protocol specification with informal correctness arguments. It first fixes the assumptions (crash failures only, messages may be lost, late, reordered or duplicated, no spoofing attacker) and explains why 2f + 1 replicas are the minimum in an asynchronous network. Each sub-protocol is then written as a numbered sequence of messages (PREPARE, PREPAREOK, COMMIT, STARTVIEWCHANGE, DOVIEWCHANGE, STARTVIEW, RECOVERY, RECOVERYRESPONSE) and the state a replica keeps (view number, status, op-number, log, commit-number, client table).

Section 8 argues safety and liveness for view changes, recovery and reconfiguration, including a three-replica scenario showing why a single exchange of DOVIEWCHANGE messages would be wrong. There is no implementation and no measurement in this report: the performance claims rest on the cited earlier systems (Harp and PBFT).

## Findings

These are the points the report establishes.

- **Commit needs f + 1 copies.** The primary treats an operation as committed once it has f PREPAREOK messages from different backups, so the operation is in the logs of at least f + 1 replicas.
- **View changes preserve committed operations.** The new primary collects f + 1 DOVIEWCHANGE messages and takes the log with the largest latest-normal view number (then the largest op-number). Quorum intersection guarantees every committed operation appears there, in the same order. Replicas must stop accepting PREPARE messages from older views as soon as they start a view change, or two primaries could be active.
- **Recovery uses volatile state.** A recovering replica needs f + 1 RECOVERYRESPONSE messages carrying its nonce, including one from the primary of the latest view, so f + 2 replicas must communicate. The paper warns that if all replicas fail at once, state is lost, so replicas must be failure independent (for example with UPS, non-volatile memory or different locations).
- **Checkpoints keep logs small.** Every O operations (on the order of 100 or 1000) the application snapshots its state, and a Merkle tree tells a recovering node which pages differ.
- **Reconfiguration pauses the service.** The reconfiguration request is the last request of the old epoch, the new epoch starts in view 0, and clients are not served until f' + 1 new replicas finish state transfer. Warming up new nodes beforehand shortens the pause.
- **Reads can be cheaper.** Reads at the primary (with leases and loosely synchronized clock rates) avoid the protocol; reads at backups give causality but not external consistency.

## Critical Analysis

This is the clearest description of a protocol that predates and parallels Paxos, and it is the usual reference for VR. Its limits are worth keeping in mind.

- **Correctness is argued informally.** The safety and liveness sections are careful prose, not proofs, and nothing is machine-checked.
- **"Simpler and faster" is not measured.** The introduction says the protocol is simpler and has better performance than the original, but this report contains no experiments.
- **Diskless recovery depends on an assumption.** Failure independence is a deployment property the protocol cannot check, and a correlated failure of all replicas loses state.
- **Crash faults only.** There is no defense against Byzantine behavior or spoofed messages unless secure channels are added.
- **Practical gaps.** Clients have one outstanding request at a time, the primary is picked round-robin by IP-address order, locating the group needs an out-of-band mechanism, and reconfiguration stops request processing for a while.

Book vs today: the leader-plus-log structure described here is what practitioners now associate with Multi-Paxos and Raft. The report says VR did not need disk I/O during its consensus protocol, unlike Paxos, but most deployed systems today still persist their log, so the diskless design is better read as an option than as the norm.

## Further Research

- Formal specification and mechanized proof of the view change, recovery and reconfiguration protocols.
- Measurements of VR against Paxos-style and Raft-style systems, which this report leaves open.
- Recovery designs that tolerate correlated failures or combine replicated state with durable storage.
- Reconfiguration with less downtime than stopping the old group.
- Byzantine-tolerant descendants of VR, such as PBFT, which the author discusses in her separate 2010 chapter on the history.

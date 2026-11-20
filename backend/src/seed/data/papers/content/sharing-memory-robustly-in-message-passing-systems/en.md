---
title: "Sharing Memory Robustly in Message-Passing Systems"
summary: Attiya, Bar-Noy and Dolev emulate a wait-free atomic single-writer multi-reader register on an asynchronous message-passing network in which fewer than half of the processors may crash. The writer sends a labelled value to a majority and waits for a majority of acknowledgments, and a reader asks a majority and announces what it will return to a majority before returning it.
researchArea: Distributed Systems
keywords: atomic register, emulation, majority, wait-free, message passing, time-stamps, crash failures
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Emulators that translate algorithms from the shared-memory model to two different message-passing models are presented. Both are achieved by implementing a wait-free, atomic, single-writer multi-reader register in unreliable, asynchronous networks. The two message-passing models considered are a complete network with processor failures and an arbitrary network with dynamic link failures. These results make it possible to view the shared-memory model as a higher-level language for designing algorithms in asynchronous distributed systems. Any wait-free algorithm based on atomic, single-writer multi-reader registers can be automatically emulated in message-passing systems, provided that at least a majority of the processors are not faulty and remain connected. The overhead introduced by these emulations is polynomial in the number of processors in the system.

## Overview

The paper appeared in the Journal of the ACM in January 1995, after a first version at the ACM Symposium on Principles of Distributed Computing in August 1990. At the time, designing fault-tolerant algorithms was easier in the shared-memory model, where a register stays readable when processors are slow or stop, than in the message-passing model, where processors hold different local views. The authors build a bridge: if a single register can be emulated over messages, every wait-free algorithm written over such registers moves to a network, and shared memory becomes, in their words, a "laboratory" for resilient algorithms.

The protocol in Section 4 is known today as ABD, from the authors' initials. The paper itself never uses that name, nor the word "quorum": it says "majority". The register it builds is atomic in the sense of [Linearizability](/papers/linearizability-correctness-condition-concurrent-objects), and the paper cites Lamport's definition. The model is the asynchronous one of [FLP](/papers/flp-impossibility-of-distributed-consensus), and the result avoids that impossibility because a register is weaker than consensus. A newer entry that starts from this protocol is [SWARM](/papers/swarm-replicating-shared-disaggregated-memory-data).

Worth knowing first: what a wait-free operation is, the difference between a read that returns the latest value and one that may return an older one, and why any two majorities of the same set of processors share at least one member.

## Contribution

- **A primitive, communicate.** A processor sends a message to everyone and collects acknowledgments from a majority, not from any particular processor. A ping-pong rule keeps one message in transit per link and at most 2n messages per call.
- **The unbounded emulator (Section 4).** The writer attaches an increasing integer label to each value and sends it to a majority. A reader asks a majority for their latest labels, adopts the largest, and announces it to a majority before returning.
- **The bounded emulator (Section 5).** The integer is replaced by a bounded sequential time-stamp system, with extra recording messages so the writer can learn every label still alive in the system.
- **Arbitrary networks (Section 6).** Two modifications handle links that fail and recover: end-to-end protocols over virtual links, and a diffusing version of communicate.
- **Consequences.** Applying the emulators to known shared-memory algorithms gives message-passing protocols for multi-writer registers, concurrent time-stamp systems, l-exclusion, atomic snapshots, randomized consensus and data structures.

## Methodology

The paper is analytic. It fixes the models (processors as state machines, executions as sequences of delivery and computation steps, messages that may be lost or reordered but never duplicated or corrupted), defines an atomic register by two properties, and fixes four cost measures: messages, message size, time and local memory. For time it assumes every message arrives within one time unit or never. Correctness rests on lemmas with proofs, summarized by pseudo-code for each emulator. There is no implementation and no experiment. I read the whole text; the asymptotic numbers below were checked in the theorems.

## Findings

- **Atomicity from majority intersection.** The key lemma (4.4) says that if one communicate call finished before another began, the label acknowledged by the second is at least the label sent by the first, because the two majorities share a processor.
- **The announcement phase is needed.** Without it, a read could return the label of a concurrent write and a later read an earlier label, which breaks the second atomicity property.
- **Unbounded emulator, Theorem 4.9.** It tolerates at most (n - 1)/2 (rounded down) processor failures, with O(n) messages and O(1) time per operation: at most 4n messages and 4 time units per read, at most 2n messages and 2 time units per write. Local memory is O(n) times the label size.
- **Bounded emulator, Theorem 5.4.5.** Same resilience, with O(n^2) messages of size O(n^3), O(1) time (at most 12 time units, Lemma 5.4.3) and O(n^4) local memory.
- **Arbitrary networks.** The end-to-end version (Theorem 6.1) needs O(n^5) messages and O(n^2) time per operation. The diffusing version (Theorem 6.2) needs O(n^4) messages, of size O(n^3), and O(n^2) time, with unbounded local space because of the Afek and Gafni constructions it uses.
- **Why a majority.** In the introduction the authors argue that for many global-coordination problems a strong adversary can split the processors into two groups of fewer than a majority that never hear from each other. A processor cut off from a majority is treated as faulty and blocks, but never returns a wrong value.

## Critical Analysis

- **The majority bound is argued, not proved here.** The reasoning is informal and refers to an earlier work cited as Attiya et al. [1989], for "many problems". There is no theorem about registers specifically, and no lower bound on the cost of the emulation: Section 7 lists lower bounds as an open question.
- **One writer only.** The multi-writer register appears as a consequence of applying the emulator to earlier shared-memory constructions, at polynomial overhead, not as a dedicated protocol. Later literature (read here only as a bibliographic record, not read in full) includes Lynch and Shvartsman, "Robust emulation of shared memory using dynamic quorum-acknowledged broadcasts" (FTCS 1997), and the RAMBO service by Gilbert, Lynch and Shvartsman (Distributed Computing, 2010). The SWARM entry describes the common multi-writer form, where a write first fetches a fresh timestamp, and reports two round trips for gets and updates in its own ABD baseline; those numbers are not from this paper.
- **Reads are the costly side.** A read takes two phases and up to 4n messages against 2n for a write. The paper does not say whether the second phase can be skipped.
- **The bounded version is heavy.** Messages of size O(n^3) and O(n^4) memory pay for bounded labels, while the authors admit that 20-bit counters would not wrap around in practice and argue that bounded solutions are more resilient to errors.
- **Crash-stop failures only.** A faulty processor simply stops; there is no recovery, no Byzantine behavior and no lying. The result covers a register, not consensus or general objects, and says nothing about performance in a real system.

## Further Research

- Cheaper emulations and lower bounds, as the paper itself asks.
- Stronger primitives. Read-Modify-Write can solve consensus, which [FLP](/papers/flp-impossibility-of-distributed-consensus) rules out in this model, so the paper suggests adding failure detectors or automatic acknowledgments, the road taken by [Chandra and Toueg](/papers/unreliable-failure-detectors-for-reliable-distributed-systems), and later by timing assumptions as in [partial synchrony](/papers/consensus-in-the-presence-of-partial-synchrony).
- Consensus-based replication with the same majority threshold, in [Paxos Made Simple](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm), and later work that needs only intersecting quorums, in [Flexible Paxos](/papers/flexible-paxos-quorum-intersection-revisited).
- Weaker guarantees in quorum stores, such as [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) and [Cassandra](/papers/cassandra-decentralized-structured-storage-system), and per-client guarantees like those in [Session Guarantees](/papers/session-guarantees-for-weakly-consistent-replicated-data). The Dynamo entry notes that its sloppy quorums do not give strong consistency, which is the contrast with this paper.

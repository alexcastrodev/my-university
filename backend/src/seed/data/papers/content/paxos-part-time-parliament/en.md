---
title: "The Part-Time Parliament"
summary: The paper that introduced Paxos, told as the story of a Greek parliament whose legislators keep a consistent record although they come and go and their messengers forget, and a way to build fault-tolerant distributed systems as replicated state machines.
researchArea: Distributed Systems
keywords: paxos, consensus, state machine replication, fault tolerance, quorums, three-phase commit, voting
version: 1.0
updatedAt: 2026-11-02
---

## Abstract

Recent archaeological discoveries on the island of Paxos reveal that the parliament functioned despite the peripatetic propensity of its part-time legislators. The legislators maintained consistent copies of the parliamentary record, despite their frequent forays from the chamber and the forgetfulness of their messengers. The Paxon parliament's protocol provides a new way of implementing the state machine approach to the design of distributed systems.

## Overview

A distributed system that must survive the failure of some of its machines often uses the state machine approach: every server runs the same deterministic program and applies the same commands in the same order, so all of them stay in the same state. The hard part is getting the servers to agree on that order when machines stop and restart and messages are lost or delayed. That agreement is the consensus problem.

This paper by Leslie Lamport, published in ACM Transactions on Computer Systems in 1998 after circulating for years as a technical report, presents the algorithm now known as Paxos. It is written as a fictional archaeological report: the legislators (priests) of the parliament on the Greek island of Paxos wander in and out of the chamber, send messages through unreliable messengers, and write in ledgers with indelible ink, yet the parliament never passes two conflicting decrees. The story maps directly onto processes, messages and stable storage.

Worth knowing first: the state machine approach, the idea of a majority quorum, and the failure model used here, where processes may stop, restart and forget everything except what they wrote to stable storage, and messages may be lost, duplicated or delayed, but nobody lies.

## Contribution

- **The single-decree Synod protocol.** A way for a group of priests to agree on one decree, based on numbered ballots. A ballot succeeds when every priest in its quorum votes for it, and three simple conditions on ballots (unique numbers, intersecting quorums, and a rule for which decree a new ballot may propose) are enough to guarantee that two successful ballots never choose different decrees.
- **A protocol that tolerates forgetting.** A priest only needs to remember, in its ledger, the latest ballot it took part in and the promises it made. Messengers may lose or repeat messages and priests may leave at any time without breaking consistency.
- **The multi-decree parliament.** Running one instance of the Synod protocol per decree number, with a single president who does the first phase once for all future decrees, so that each later decree needs only one round of messages to a majority. This is what is now called Multi-Paxos.
- **Practical details for a real system.** Filling gaps in the sequence of decrees with harmless decrees, reading the current state consistently, and changing the membership of the parliament by passing a decree that sets the legislators for later decrees.
- **A link to computer science.** A closing section explains how the parliament implements the state machine approach and compares it with related work, such as the viewstamped replication of Oki and Liskov.

## Methodology

The paper is a protocol design with proofs, and its method is to derive the protocol from the properties it must keep. It starts with the safety requirement (only one decree can be chosen), states sufficient conditions on the set of ballots (called B1, B2 and B3 in the paper), and proves that any set of ballots satisfying them is consistent. It then refines these conditions step by step into a preliminary protocol, a basic protocol and the complete Synod protocol, each implementing the conditions with messages and ledger entries.

Progress is treated separately. The paper shows that if one priest is chosen as president and it and a majority of priests stay in the chamber long enough, without interference from other presidents, a decree will be passed. Choosing the president relies on timeouts and is not part of the safety argument. The multi-decree parliament and the extensions for membership changes and reads are then built on the same base. The paper presents correctness arguments but no implementation or measurements.

## Findings

These are the results the paper argues for.

- **Consistency.** If the set of ballots satisfies the three conditions, any two successful ballots have the same decree. The proof uses the fact that any two quorums share at least one priest, which holds when a quorum is any majority.
- **Safety under the failure model.** The Synod protocol keeps consistency whatever messages are lost or duplicated and whenever priests leave, as long as each priest keeps its ledger.
- **Progress needs a stable leader.** No ballot is guaranteed to succeed in general, but a single president with a majority of priests present for long enough will pass a decree.
- **One round per decree in the steady state.** With a stable president, the first phase is done once, and each new decree needs one exchange of messages with a majority, which is the cost that makes the multi-decree protocol practical.
- **Membership can change by decree.** The legislators for a decree are determined by a law passed some fixed number of decrees earlier, so the protocol can change who votes without stopping.

## Critical Analysis

This is one of the most important papers in distributed systems, and much of how replicated databases and coordination services work today descends from it. Still, read it with some care.

- **The allegory makes it hard to read.** The story is elegant once understood, but it hides the algorithm behind ledgers, priests and decrees. Lamport later wrote [Paxos Made Simple](/papers/paxos-made-simple) (2001) to explain the same idea plainly, and the [Raft paper](/papers/raft-understandable-consensus-algorithm) (2014) argues that Paxos is hard to learn and to build on.
- **The multi-decree part is sketched more than specified.** The single-decree protocol is precise, but how to elect the president, handle client requests, compact the record and reconfigure is described briefly. Each real system has had to fill these gaps, and different fillings lead to subtly different and sometimes incorrect implementations.
- **Progress is outside the guarantee.** As with any asynchronous consensus protocol, termination depends on timing assumptions and on electing one leader. The paper is clear about this, but a system that uses Paxos must still solve leader election well.
- **The failure model excludes malicious behavior.** Priests may forget and leave, but they never lie, so the protocol does not tolerate arbitrary (Byzantine) faults.
- **There is no evaluation.** The paper argues correctness and message cost but has no implementation or measurement, which was common for protocol papers of its kind.

## Further Research

- Clearer presentations and fully specified variants, from [Paxos Made Simple](/papers/paxos-made-simple) to Multi-Paxos descriptions used in production and to Raft.
- Optimizations of the protocol, such as variants that save a message delay (Fast Paxos), avoid a single leader, or use smaller or flexible quorums.
- Variants that tolerate arbitrary faults, which led to Byzantine fault-tolerant consensus.
- Formal specification and mechanical verification of Paxos and of the systems built on it, for example in TLA+ and with proof assistants.
- Engineering questions the paper leaves open: leader election, log compaction, reconfiguration and reads that keep linearizability without going through the log.

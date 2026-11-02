---
title: "Paxos Made Simple"
summary: Lamport's plain-English retelling of Paxos, which derives the single-decree consensus algorithm step by step from its safety requirements and then shows how a sequence of its instances implements a replicated state machine.
researchArea: Distributed Systems
keywords: paxos, consensus, state machine replication, fault tolerance, quorums, leader election
version: 1.0
updatedAt: 2026-11-02
---

## Abstract

The Paxos algorithm, when presented in plain English, is very simple.

## Overview

Paxos first appeared in [The Part-Time Parliament](/papers/paxos-part-time-parliament), written as the story of a fictional Greek parliament. Many readers found the allegory hard to follow, and the algorithm gained a reputation for being difficult. In this short note, published in ACM SIGACT News in 2001, Leslie Lamport presents the same algorithm with no story and almost no formalism, and argues that it follows almost inevitably from the properties a consensus algorithm must have.

The problem is to get a collection of processes to choose a single value among those proposed, even when processes fail and restart and messages are lost. Once that works, running it once per position of a log lets a group of servers apply the same commands in the same order, which is the state machine approach to fault-tolerant systems.

Worth knowing first: the idea of a majority quorum, the asynchronous model (no bound on how long a message or a step may take), and the non-Byzantine failure model, where processes may stop and restart and messages may be lost or duplicated, but nothing is corrupted and nobody lies.

## Contribution

- **A clear statement of the problem.** Only a proposed value may be chosen, only one value is chosen, and a process never learns that a value was chosen unless it actually was.
- **Three roles.** Proposers suggest values, acceptors vote on them, and learners find out what was chosen. A real process usually plays all three.
- **A derivation instead of a description.** Starting from the safety requirement, the paper strengthens a property step by step (named P1, P2, P2a, P2b and P2c) until it reaches one that a protocol can enforce directly with numbered proposals.
- **The two-phase protocol.** In phase 1 a proposer sends a prepare request with a number n and each acceptor promises to ignore lower numbers, reporting the highest-numbered proposal it already accepted. In phase 2 the proposer asks the acceptors to accept a value, which must be the value of that highest proposal if there was one.
- **From one value to a state machine.** A distinguished leader runs phase 1 once for all future log positions, so each new command needs only phase 2. Gaps left by a failed leader are filled with no-op commands.

## Methodology

The note is a derivation, not an experiment. It starts from the requirements, observes that a single acceptor would be a single point of failure, and moves to a majority of acceptors, relying on the fact that any two majorities share at least one acceptor. Each step asks what an acceptor or proposer must guarantee so that, once a value is chosen, every higher-numbered proposal that is later chosen carries the same value, and then turns that guarantee into a rule about messages.

Learning, progress and implementation are treated as separate questions after safety. The paper explains how learners can be informed directly or through a set of distinguished learners, why progress needs a single distinguished proposer, and what each process must keep in stable storage. The last section builds the replicated state machine on top. There is no implementation, proof assistant or measurement; the arguments are informal but precise.

## Findings

These are the points the paper establishes.

- **Safety follows from the phase 1 promise.** Because a proposer only proposes the value of the highest-numbered proposal reported by a majority, and acceptors keep their promises, a chosen value is never replaced by another.
- **An acceptor needs little memory.** It only has to remember, across failures, the highest-numbered proposal it accepted and the highest prepare request it answered.
- **Progress is not guaranteed in general.** Two proposers can keep issuing higher numbers and block each other forever. Electing a single distinguished proposer avoids this, and the paper notes that the FLP result means a reliable election needs randomness or real time, such as timeouts.
- **One round trip per command in the steady state.** With a stable leader, phase 1 is done once and each command costs one exchange of phase 2 messages with a majority.
- **Reconfiguration can be part of the log.** The set of servers can itself be a value of the state machine, used for commands a fixed number of positions later.

## Critical Analysis

The note keeps its promise: the single-decree algorithm really is short and readable here, and it is the version most people learn first. Some limits are worth keeping in mind.

- **The state machine section is brief.** Leader election, client interaction, log compaction and reconfiguration get a few paragraphs. These are exactly the parts real systems find hard, and the gap between this note and a working system is large, as later papers such as [Raft](/papers/raft-understandable-consensus-algorithm) point out.
- **The arguments are informal.** The derivation is convincing, but it is not a proof in the formal sense; for that the reader goes back to The Part-Time Parliament or to later mechanized proofs.
- **"Simple" depends on the reader.** The derivation of P2c is the step most readers need to read several times, and the paper does not give a worked example of a failure scenario.
- **The failure model excludes malicious behavior,** as in the original paper, so the algorithm does not tolerate arbitrary (Byzantine) faults.
- **There is no evaluation of cost,** beyond counting message rounds, which is fine for its purpose but leaves performance questions open.

## Further Research

- Complete, implementable specifications of Multi-Paxos, including leader election, client requests and snapshots.
- Variants that reduce latency or relax quorum rules, such as Fast Paxos and flexible quorums.
- Algorithms designed for understandability from the start, such as Raft, and studies of how people learn consensus.
- Formal specifications and machine-checked proofs of Paxos and its variants, for example in TLA+.
- Byzantine fault-tolerant versions of the same ideas.

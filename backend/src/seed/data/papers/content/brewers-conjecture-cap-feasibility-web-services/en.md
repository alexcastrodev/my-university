---
title: "Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services"
summary: Gilbert and Lynch formalize Eric Brewer's CAP conjecture and prove it: in an asynchronous network, no read/write object can be both atomically consistent and always available if messages may be lost. They then show that adding timers lets a service keep consistency when the network is healthy and degrade in a controlled way when it is not.
researchArea: Distributed Systems
keywords: CAP theorem, consistency, availability, partition tolerance, linearizability, impossibility result, partial synchrony
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

When designing distributed web services, there are three properties that are commonly desired: consistency, availability, and partition tolerance. It is impossible to achieve all three. In this note, we prove this conjecture in the asynchronous network model, and then discuss solutions to this dilemma in the partially synchronous model.

## Overview

At PODC 2000, Eric Brewer gave an invited talk, "Towards robust distributed systems", in which he conjectured that a web service cannot provide consistency, availability and partition tolerance all at once. The three words had no precise meaning, so the claim could be neither proved nor refuted. This note, published in ACM SIGACT News in June 2002, is the paper that turned the slogan into a theorem and gave it the name "CAP" that later work uses.

It belongs to the family of impossibility results that began with [FLP](/papers/flp-impossibility-of-distributed-consensus). Both rely on the asynchronous model, in which a node cannot tell a lost or slow message from a late one, and both use an indistinguishability argument. The note is also a reminder of why the replicated state machine of [Paxos](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm) cannot promise to answer every client during a partition.

Worth knowing first: linearizability (every operation appears to take effect at a single instant, in an order that respects real time), the asynchronous message-passing model, and the difference between safety ("nothing bad happens") and liveness ("something good eventually happens").

## Contribution

- **Precise definitions.** Consistency becomes atomic (linearizable) consistency of a read/write object. Availability means every request received by a non-failing node must eventually get a response, with no bound on how long. Partition tolerance means the network may lose arbitrarily many messages between nodes.
- **The impossibility theorem.** In the asynchronous model no read/write object guarantees availability and atomic consistency in all fair executions, including those where messages are lost (Theorem 1).
- **A stronger corollary.** The same holds even if atomicity is only required in executions where no message is lost (Corollary 1.1), because in this model an algorithm cannot tell a lost message from a delayed one.
- **A map of what is possible.** Any two of the three properties can be achieved: atomic and partition tolerant, atomic and available, or available and partition tolerant, each with a simple example.
- **A way out.** In a partially synchronous model, the corollary no longer holds, and the note defines Delayed-t consistency as a weaker guarantee with an explicit time bound.

## Methodology

The note is a formal argument, with no implementation or experiment. The impossibility proof splits the nodes into two non-empty sets, G1 and G2, and assumes every message between them is lost. A write of a value different from the initial value v0 completes in G1, because the service is available. A later read in G2 must also return, again by availability, but G2 cannot distinguish this execution from one where the write never happened, so it returns v0. The read starts after the write finished, which contradicts atomicity.

The corollary is proved by extension: if some algorithm were atomic whenever all messages are delivered, take an execution with a non-atomic response, cut it at that response, and extend the prefix into a fair execution where every message is delivered. The result is non-atomic, a contradiction. The partially synchronous model gives every node a timer, a known bound t_msg on message delivery (or the message is lost) and a known bound t_local on processing. Theorem 2 repeats the proof with a long idle period in G2 so that the write finishes before the read begins. The constructive part is a centralized algorithm with timeouts, proved correct against the Delayed-t definition.

## Findings

These are results of the proofs, not of measurements.

- **Theorem 1.** No algorithm in the asynchronous model gives both availability and atomic consistency in all fair executions, including those that lose messages.
- **Corollary 1.1.** Atomicity cannot even be reserved for the loss-free executions, since an asynchronous algorithm cannot detect a lost message.
- **Theorem 2.** Partial synchrony does not remove the impossibility when arbitrary messages may be lost.
- **The corollary stops holding with timers.** A node that waits 2 * t_msg + t_local for the central node can conclude a message was lost, and answer with its best known value. The result is atomic data when messages are delivered and possibly stale data when they are not.
- **Theorem 4.** The modified centralized algorithm is Delayed-t consistent: if a stretch longer than t passes without message loss, later operations no longer precede earlier completed ones in the partial order. The paper notes the link to eventually-serializable data services, but with an explicit time bound.

## Critical Analysis

The theorem is narrow, and that is its value, but it is often quoted more broadly than it was proved.

- **Availability is strong and weak at once.** It demands a response from every non-failing node even when it is cut off from all others, yet puts no bound on latency, so "slow but eventually answering" counts as available. Real services are judged by latency and by the fraction of requests served, not by this definition.
- **Consistency means linearizability only.** The result says nothing about weaker models that many databases offer. The note itself says availability together with weaker consistency is achievable, and only sketches one such model.
- **It is a statement about partitions, not about a permanent choice.** Choosing "two of three" suggests a fixed label for a system, but the trade-off only bites while a partition lasts, and the paper's partially synchronous algorithm already changes behavior at that point.
- **The model is small.** One read/write object, no stopping failures (the introduction sets crashes aside), a centralized solution as the main example, and a Delayed-t proof of a few paragraphs. It does not discuss durability, replication cost or multi-object transactions.
- **Book versus today.** The paper is a note of nine pages in the journal, and its own conclusion points to "most of the data, most of the time" as future theoretical work. Later work, including Brewer's own retrospective and Gilbert and Lynch's later "Perspectives on the CAP Theorem", argues the trade-off is more nuanced than the 2000 slogan.

## Further Research

- Treating latency and a continuum of consistency levels, not just a binary availability, since real services are judged on both.
- Systems that stay consistent and make partitions rare, such as [Spanner](/papers/spanner-globally-distributed-database), and ones that avoid coordination where possible, such as [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) and [Eris](/papers/eris-coordination-free-consistent-transactions).
- Causal consistency as a model that remains available under partitions, as in [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) and [Antipode](/papers/antipode-cross-service-causal-consistency-in-distributed-applications).
- Formalizing "most of the data, most of the time", which the paper names as future work.
- Reading the result next to [FLP](/papers/flp-impossibility-of-distributed-consensus) and the [Byzantine Generals](/papers/byzantine-generals-problem) problem as a set of limits on what an unreliable network allows.

---
title: "In Search of an Understandable Consensus Algorithm"
summary: Raft is a consensus algorithm for a replicated log, designed first of all to be easy to learn and to build on, with a strong leader, randomized elections and a safe way to change cluster membership.
researchArea: Distributed Systems
keywords: consensus, raft, paxos, replicated log, leader election, state machine replication
version: 1.0
updatedAt: 2026-11-01
---

## Overview

A consensus algorithm lets a group of machines behave as one coherent system that survives the failure of some members. It is the base of lock services, configuration stores and replicated databases. For about a decade the standard answer was Paxos, and the authors of this paper from Stanford argue that it is hard to learn and gives builders little to start from, since the common description covers a single decision and leaves the replicated log, the part systems actually need, to the reader.

This USENIX ATC 2014 paper takes an unusual goal: understandability as the main design criterion. The result is Raft, which the authors present as equivalent to multi-Paxos in what it guarantees and as efficient, but organised so that people can reason about it.

Worth knowing first: replicated state machines (servers that apply the same commands in the same order), the idea of a majority quorum, and the failure model used here, where servers stop and may come back, and messages can be delayed, lost or reordered, but nobody lies.

## Contribution

- **Decomposition.** Raft separates leader election, log replication, safety and membership changes, so each can be explained on its own.
- **A strong leader.** Log entries flow only from the leader to the other servers, which removes whole classes of cases that a symmetric protocol has to handle.
- **Randomized election timeouts.** Elections reuse the heartbeat mechanism and resolve conflicts with a small random delay.
- **Joint consensus for membership changes.** During a change, decisions need a majority of the old and of the new configuration at the same time, so the cluster keeps working while it changes.
- **A user study** comparing how well students learn Raft and Paxos, which makes understandability something the paper tries to measure.

## Methodology

The authors designed by comparing alternatives on how hard each is to explain, using two techniques: dividing the problem into independent pieces, and shrinking the state space, for example by never allowing holes in a log and by limiting the ways logs can differ.

The evaluation has three parts. For understandability, 43 students from a Stanford operating systems course and a Berkeley distributed computing course watched a video lecture on each algorithm and took a quiz after each, with about half starting with Paxos and half with Raft. The authors took steps against bias: the same lecturer, quizzes paired by difficulty, grading with a rubric in random order. For correctness, they wrote a TLA+ specification of about 400 lines and a proof of safety. For performance, they implemented Raft in about 2,000 lines of C++ for RAMCloud's configuration store and timed leader election on a cluster of five servers.

## Findings

These are the authors' reported results.

- 33 of the 43 students scored higher on the Raft quiz than on the Paxos quiz. The mean was 25.7 of 60 points for Raft and 20.8 for Paxos, and a paired t-test puts the true difference at least 2.5 points at 95% confidence.
- In a survey, 33 of 41 participants said Raft would be easier to implement, and the same number said it would be easier to explain. The authors note that this self-report may be biased by knowing their hypothesis.
- A mechanical proof of the Log Completeness property in the TLA proof system, relying on some invariants that were not mechanically checked, and an informal proof of State Machine Safety of about 3,500 words.
- With no randomness, leader election took more than 10 seconds in their tests because of repeated split votes. With 5 ms of randomness the median downtime was 287 ms, and with 50 ms the worst case over 1,000 trials was 513 ms. With election timeouts of 12 to 24 ms, a new leader took 35 ms on average.
- About 25 third-party implementations existed at the time, built from drafts of the paper.

## Critical Analysis

The paper makes a good case that structure helps, and it is unusual in testing the claim. Still, read the evidence with care.

- **The study is small and close to the authors.** The participants are students, many with earlier exposure to Paxos, the quizzes and the Paxos lecture were prepared by the Raft authors, and the participants knew the hypothesis. The authors mitigate this and report the bias risk themselves, but the result is evidence, not proof, of understandability.
- **Performance is argued more than measured.** The claim that Raft performs like Paxos rests on the message count (one round trip to a majority) and not on a head-to-head benchmark. The measurements cover leader election only.
- **A strong leader is a design choice with a cost.** All writes pass through one server, so its capacity bounds throughput. The paper points to batching and pipelining as ways to help, without measuring them.
- **The failure model is narrow.** Servers may crash and recover, but a faulty or malicious server is out of scope, as it is for Paxos.
- **Some parts are missing from the page limit.** Client interaction (and linearizable semantics) and log compaction are left to the extended report, and the safety proof is only partly mechanical.

## Further Research

- Reading and writing clients efficiently, for example reads that skip the log without losing linearizability.
- Performance work on batching, pipelining and leader capacity, with a benchmark that compares Raft with Paxos variants under the same load.
- Larger or more varied studies of how people learn consensus, since understandability is the paper's central claim.
- Fully mechanized proofs of the whole protocol, including membership changes.
- Variants that tolerate arbitrary (Byzantine) faults.

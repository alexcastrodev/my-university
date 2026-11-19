---
title: "Consensus: Bridging Theory and Practice"
summary: Diego Ongaro's doctoral dissertation, the complete reference for Raft. It expands the short conference paper with the full algorithm, single-server membership changes, log compaction, client linearizability, a TLA+ specification and safety proof, a user study against Paxos, and evaluations of leader election and replication.
researchArea: Distributed Systems
keywords: raft, consensus, replicated state machine, membership changes, log compaction, linearizability, formal verification, user study
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Distributed consensus is fundamental to building fault-tolerant systems. It allows a collection of machines to work as a coherent group that can survive the failures of some of its members. Unfortunately, the most common consensus algorithm, Paxos, is widely regarded as difficult to understand and implement correctly.

This dissertation presents a new consensus algorithm called Raft, which was designed for understandability. Raft first elects a server as leader, then concentrates all decision-making onto the leader. These two basic steps are relatively independent and form a better structure than Paxos, whose components are hard to separate. Raft elects a leader using voting and randomized timeouts. The election guarantees that the leader already stores all the information it needs, so data only flows outwards from the leader to other servers. Compared to other leader-based algorithms, this reduces mechanism and simplifies the behavior. Once a leader is elected, it manages a replicated log. Raft leverages a simple invariant on how logs grow to reduce the algorithm's state space and accomplish this task with minimal mechanism.

Raft is also more suitable than previous algorithms for real-world implementations. It performs well enough for practical deployments, and it addresses all aspects of building a complete system, including how to manage client interactions, how to change the cluster membership, and how to compact the log when it grows too large. To change the cluster membership, Raft allows adding or removing one server at a time (complex changes can be composed from these basic steps), and the cluster continues servicing requests throughout the change. We believe that Raft is superior to Paxos and other consensus algorithms, both for educational purposes and as a foundation for implementation. Results from a user study demonstrate that Raft is easier for students to learn than Paxos. The algorithm has been formally specified and proven, its leader election algorithm works well in a variety of environments, and its performance is equivalent to Multi-Paxos. Many implementations of Raft are now available, and several companies are deploying Raft.

## Overview

This is the thesis behind [In Search of an Understandable Consensus Algorithm](/papers/raft-understandable-consensus-algorithm), the short Raft paper (USENIX ATC 2014). Diego Ongaro wrote it at Stanford under John Ousterhout, and says that most of that paper's content is included in some form. Read the short paper first for the idea; read this when you need to implement Raft or check a detail the paper skipped. The target is Paxos, in the form retold in [Paxos Made Simple](/papers/paxos-made-simple) and its many elaborations: the thesis argues it is hard to learn and gives too little guidance for a real replicated log (Chapter 2). The closest relatives are [Viewstamped Replication Revisited](/papers/viewstamped-replication-revisited) and [Zab](/papers/zab-high-performance-broadcast-primary-backup-systems), and the dissertation compares Raft with them in Chapter 11.

After the introduction and motivation (Chapters 1 and 2), Chapters 3 to 6 present the algorithm, its extensions and the client side. Chapters 7 to 10 evaluate it: understandability, correctness, leader election and performance. Chapter 11 is related work and Chapter 12 closes with lessons learned. Appendix A has the study materials and Appendix B the TLA+ specification and proof.

Worth knowing first: replicated state machines, majority quorums, and the failure model (servers stop and may restart from stable storage, the network may lose, duplicate and reorder messages, no Byzantine faults, and safety never depends on timing).

## Contribution

- **A complete specification (Ch. 3).** Two core RPCs, RequestVote and AppendEntries, five guaranteed properties (Election Safety, Leader Append-Only, Log Matching, Leader Completeness, State Machine Safety), the election restriction, and the rule that a leader never commits entries from older terms by counting replicas. It also covers persisted state, the timing requirement and an optional leadership transfer with a TimeoutNow request.
- **Single-server membership changes (Ch. 4).** AddServer and RemoveServer RPCs, configurations stored as log entries and used as soon as they are appended, non-voting catch-up rounds for new servers, and a heartbeat-based rule so that removed servers cannot disrupt the leader. Section 4.3 keeps the original joint consensus approach for arbitrary changes, but recommends the single-server one.
- **Log compaction (Ch. 5).** Each server compacts its own committed prefix. Snapshots for in-memory state machines with an InstallSnapshot RPC, plus sketches for disk-based state machines, log cleaning and LSM trees, and leader-based alternatives that the author rejects.
- **Client interaction (Ch. 6).** Finding the cluster, redirecting to the leader, sessions with serial numbers for exactly-once effects, and read-only queries that skip the log.
- **Evidence (Ch. 7 to 10, Appendix B).** The first user study of consensus algorithms by teaching and learning, a formal specification and safety proof, an analysis of election timing, and measurements of a working implementation called LogCabin.

## Methodology

The method is design plus evaluation on four fronts. Understandability was tested with a within-subjects study: video lectures and quizzes on Raft and Paxos, counterbalanced by order, with students from a Stanford (CS 240) and a Berkeley (CS 294-91) course (Ch. 7). Correctness uses a TLA+ specification of about 450 lines and a proof of about 3,500 words, built on history variables and induction over executions (Ch. 8, Appendix B). Earlier attempts with the Murphi model checker, the TLA model checker and the TLA proof system are reported too.

Leader election is analyzed with probability models and checked on LogCabin, a C++ implementation of about 2,000 lines, on five servers with gigabit Ethernet and SSDs (Ch. 9). Wide-area behavior comes from a simulator the author wrote, AvailSim. Replication performance is measured on LogCabin with a single client process and one kilobyte writes (Ch. 10). Ideas that were not built, such as disk-based snapshots, LSM trees and clock-based reads, are described as speculation.

## Findings

- **Understandability (Ch. 7).** Raft quiz scores averaged 25.7 out of 60 against 21.0 for Paxos, 22.6% higher (one-sided t-test, p = 0.009). Among 43 people who took both quizzes, 33 scored higher on Raft (paired test, p = 0.001), and 33 of 41 said Raft would be easier to implement and to explain. A regression predicts 12.5 points more on Raft for students with no prior Paxos experience.
- **Safety proof (Ch. 8).** Nine lemmas lead to a theorem equivalent to State Machine Safety. It covers the basic algorithm of Chapter 3 only. Membership changes, compaction, client interaction, liveness and availability are left to future work.
- **Elections (Ch. 9).** Without a split vote, an election finishes about one third into the timeout range. A range of 10 to 20 times the one-way latency is recommended, and the expected number of terms is 1 / (1 - split vote rate). On the LAN, no randomness took over 10 s, 5 ms of randomness gave a median of 287 ms, and timeouts of 12 to 24 ms gave 35 ms on average (the author still suggests 150 to 300 ms). In the simulated wide area network (30 to 40 ms one way), 99.9% of elections finished within 1.5 s with one failed server and within 3 s with two.
- **Performance (Ch. 10).** A three-server LogCabin cluster sustained about 19,500 one-kilobyte writes per second with 100 client threads, and a write took about 1.0 ms with one thread. Writing the leader's disk in parallel, batching and pipelining are the main optimizations.
- **Snapshots (Ch. 5).** Snapshotting when the log reaches 4 times the previous snapshot uses about 20% of disk bandwidth and about 6 times the state size in disk space.
- **Reads (Ch. 6).** A leader serves a linearizable read after committing a no-op in its term, recording its commit index (readIndex), confirming leadership with a heartbeat round, and waiting for the state machine to reach that index. Lease-based reads need a clock drift bound and are not recommended unless required.

## Critical Analysis

This is the authoritative source for Raft, and it is unusually frank about what it did not do. Limits worth keeping in mind:

- **The study has limits.** The authors made both lectures and both quizzes, Stanford students got course credit, and the Paxos version was the authors' own elaboration. The text says it countered the major sources of bias and calls the evidence substantial, but it measures learning after about an hour, not building a system.
- **Performance is preliminary.** Only clusters of one to five servers with an in-memory state machine and no compaction were measured. Read throughput, reconfiguration cost and compaction cost are listed as open questions, and the first pipelining implementation did not make it into LogCabin's main branch, as the author's errata says.
- **Several designs were never built.** Leadership transfer, disk-based snapshots, LSM and log-cleaning compaction and follower reads are sketches.
- **The proof is paper only.** The author says it may contain errors and that only a machine-checked proof would settle it.
- **Pre-Vote has two roles.** Section 4.2.3 shows that comparing logs cannot stop a removed server from disrupting the cluster, while Section 9.6 recommends Pre-Vote only for a partitioned server that rejoins.

Later literature, not part of the 2014 text. The author's own errata page for the dissertation lists these items. First, an "important bug" in single-server changes, described in a raft-dev post dated 10 July 2015 and found by Huanchen Zhang while formalizing them with Brandon Amos at CMU. Competing changes across leader changes, starting from an even-sized cluster, can have non-overlapping quorums and overwrite a committed entry. The fix is that a leader must not append a configuration entry until it has committed an entry from its current term (the usual no-op). Joint consensus is not affected. Second, `lastApplied` must be as persistent as the state machine. Third, the Verdi team at the University of Washington completed a machine-checked Coq proof for basic Raft.

## Further Research

- Safety and liveness proofs for membership changes, compaction and client interaction, ideally machine-checked.
- Scheduling snapshots so that clients never wait on a server that is snapshotting, and incremental compaction built on LSM trees.
- Dynamic election timeouts, and election behavior under asymmetric networks, packet loss and clock drift.
- Reducing the leader bottleneck and wide-area latency, for example with the approaches of [Egalitarian Paxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments), which the thesis discusses in Chapter 11.
- Cheaper ways to study understandability, such as online courses and A/B tests of explanations.

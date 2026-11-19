---
title: "Paxos vs Raft: Have we reached consensus on distributed consensus?"
summary: Howard and Mortier restate a simplified Multi-Paxos in Raft's own terminology and find that the two algorithms differ only in leader election, so most of Raft's appeal comes from its presentation, while its election is surprisingly cheap because no log entries travel during it.
researchArea: Distributed Systems
keywords: paxos, raft, consensus, leader election, state machine replication, understandability, multi-paxos
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Distributed consensus is a fundamental primitive for constructing fault-tolerant, strongly-consistent distributed systems. Though many distributed consensus algorithms have been proposed, just two dominate production systems: Paxos, the traditional, famously subtle, algorithm; and Raft, a more recent algorithm positioned as a more understandable alternative to Paxos.

In this paper, we consider the question of which algorithm, Paxos or Raft, is the better solution to distributed consensus? We analyse both to determine exactly how they differ by describing a simplified Paxos algorithm using Raft's terminology and pragmatic abstractions.

We find that both Paxos and Raft take a very similar approach to distributed consensus, differing only in their approach to leader election. Most notably, Raft only allows servers with up-to-date logs to become leaders, whereas Paxos allows any server to be leader provided it then updates its log to ensure it is up-to-date. Raft's approach is surprisingly efficient given its simplicity as, unlike Paxos, it does not require log entries to be exchanged during leader election. We surmise that much of the understandability of Raft comes from the paper's clear presentation rather than being fundamental to the underlying algorithm being presented.

## Overview

A short workshop paper (PaPoC 2020, co-located with EuroSys) from the University of Cambridge. By 2020 production systems were split: the paper lists Megastore, Chubby, Omega, Azure Data Lake Store, Borg and PaxosStore on the Paxos side, and Atomix, CockroachDB, Consul, etcd, Kubernetes, M3 and Trillian on the Raft side. Paxos comes from [The Part-Time Parliament](/papers/paxos-part-time-parliament) and [Paxos Made Simple](/papers/paxos-made-simple), and the engineering gaps are described in [Paxos Made Live](/papers/paxos-made-live-engineering-perspective). Raft is [In Search of an Understandable Consensus Algorithm](/papers/raft-understandable-consensus-algorithm), with the full treatment in the [Raft thesis](/papers/consensus-bridging-theory-and-practice-raft-thesis).

The setting is state machine replication ([Schneider's tutorial](/papers/state-machine-approach-fault-tolerant-services-tutorial)): every server applies the same operations in the same order, so clients see a [linearizable](/papers/linearizability-correctness-condition-concurrent-objects) service. The paper assumes no Byzantine faults, an asynchronous system, and reliable in-order message delivery (TCP). Clocks are not needed for safety, only for liveness, as the [FLP result](/papers/flp-impossibility-of-distributed-consensus) requires.

Worth knowing first: majority quorums, terms (also called views or ballots) and the leader-based replicated log.

## Contribution

- **A survey-based simplified Paxos.** Because Paxos is a family whose descriptions vary from paper to paper, the authors survey the literature and write down one multi-decree version, closer to how Paxos is used today than to the original.
- **Raft's vocabulary for Paxos.** That version is written with Raft's state, RPCs (RequestVote, AppendEntries) and rules, so the two can be compared line by line (Appendices A and B).
- **The central claim.** The algorithms differ only in leader election, in three ways (see Findings).
- **A verdict on Raft's three claimed advantages.** Presentation, simplicity and a novel election: the authors credit most of the appeal to the first.
- **A mapping to classical Paxos.** Section 5 relates the single "server" role, terms and phases to proposer, acceptor and learner, ballots and phase 1 and 2.

## Methodology

The paper is a conceptual comparison, not an experiment. Both protocols share one skeleton: servers are followers, candidates or leaders; terms increase monotonically; the leader appends an operation with its term to its log, sends AppendEntries to the others, and commits once a majority acknowledges. Followers accept entries only if the preceding entry matches the leader's log, which keeps logs in order without gaps.

The two protocols are then compared by phase.

- **Phase 1 in Paxos.** A follower that times out takes the next term t with t mod n = s (s is its id). It sends RequestVote with its term and commit index. A server replies positively if the term is greater than its own, attaching its log entries after the candidate's commit index. With a majority of replies, the candidate fills each later index with the entry of the greatest term it has seen, stamps these entries with its new term, and becomes leader.
- **Phase 1 in Raft.** A candidate may use any term, increments it and sends its last log term and index. A server votes if the term is not lower, it has not voted in this term, and the candidate's log is at least as up-to-date. With a majority of votes the candidate becomes leader immediately.
- **Phase 2 in both.** AppendEntries replication, with a different commit rule (below).

Safety is argued with a proof sketch of Leader Completeness by induction over terms, for Paxos in the text. The authors say the Raft proof uses the same induction with different details. The comparison leaves out garbage collection, log compaction, reads and reconfiguration.

## Findings

Table 1 summarizes three differences, all in leader election.

- **Leaders per term.** Paxos gives each server its own terms (t mod n = s), so at most one candidate exists per term. In Raft any follower may be a candidate in any term, and each follower votes for only one candidate per term.
- **Getting committed entries into the new leader.** Paxos followers vote for any candidate and ship their log entries back, and the candidate adopts them. Raft grants a vote only to a candidate with an at-least-as-up-to-date log, so a candidate only wins if its log is at least as up-to-date as a majority of followers.
- **Entries from earlier terms.** Paxos re-stamps them with the leader's term and replicates them as if new, so they are safe to commit once on a majority. Raft keeps their original term and a leader may commit them only after committing a later entry from its own term.

On understandability the authors feel that Raft's unique (index, term) pair per operation is slightly more intuitive than Paxos, where an entry can be re-stamped (operations B and C in Figure 2b), but conclude that Raft is "slightly more understandable than Paxos' but not significantly so". On efficiency they expect Raft's elections to be slower and more variable, because simultaneous candidates can split votes and Raft adds a random wait. In return Raft's election is lighter: no log entries are sent in votes, and Paxos may send an entry again under a new term. Overall: no significant difference in understandability, and Raft's election is "surprisingly lightweight".

## Critical Analysis

What the paper does not claim matters as much as what it does.

- **Not a proof of equivalence.** The comparison is between the authors' own simplified Paxos and Raft. It covers in-order decisions only, with a single server role and no log-gap filling, which the paper itself says is not necessary but avoids complexity. Out-of-order Multi-Paxos is outside the comparison.
- **No performance measurement.** The efficiency claims are reasoning ("we expect") and message counting. No benchmark is run, and both algorithms are called naive by design.
- **Understandability is a judgment, not a study.** "We feel" is the evidence. For comparison, the Raft thesis reports a user study with students in its own abstract, and this paper does not repeat one.
- **Scope.** Compaction, reads and reconfiguration, where real systems differ most, are left out.
- **No variant is proposed.** The paper suggests only that Raft could now benefit from decades of Paxos optimizations and vice versa. It does not propose a Raft with flexible quorums. [Flexible Paxos](/papers/flexible-paxos-quorum-intersection-revisited), also by Howard, is a catalog neighbor but is not cited here.
- **Later literature:** not read for this note.

## Further Research

- Port Paxos optimizations such as [EPaxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments) into Raft-style presentations, and Raft-side work such as the leader-or-majority read scaling of reference [1] into Paxos.
- Measure election time and its variance, and the bytes moved during elections, which the paper only predicts.
- Run controlled studies of understandability, since the paper supplies none.
- Extend the line-by-line comparison to log compaction, reads and reconfiguration. [Viewstamped Replication Revisited](/papers/viewstamped-replication-revisited), a leader-based relative not cited in the paper, is a natural third column.

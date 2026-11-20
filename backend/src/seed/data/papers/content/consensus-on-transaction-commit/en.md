---
title: "Consensus on Transaction Commit"
summary: Gray and Lamport run one Paxos instance per resource manager to decide whether it prepared or aborted, which gives Paxos Commit, a transaction commit protocol that keeps deciding while a majority of its 2F + 1 coordinators work, and show that Two-Phase Commit is the F = 0 case.
researchArea: Distributed Systems
keywords: atomic commit, two-phase commit, paxos commit, consensus, transaction commit, TLA+, fault tolerance
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

The distributed transaction commit problem requires reaching agreement on whether a transaction is committed or aborted. The classic Two-Phase Commit protocol blocks if the coordinator fails. Fault-tolerant consensus algorithms also reach agreement, but do not block whenever any majority of the processes are working. The Paxos Commit algorithm runs a Paxos consensus algorithm on the commit/abort decision of each participant to obtain a transaction commit protocol that uses 2F + 1 coordinators and makes progress if at least F + 1 of them are working properly. Paxos Commit has the same stable-storage write delay, and can be implemented to have the same message delay in the fault-free case, as Two-Phase Commit, but it uses more messages. The classic Two-Phase Commit algorithm is obtained as the special F = 0 case of the Paxos Commit algorithm.

## Overview

A distributed transaction touches several sites, called resource managers (RMs), and it may commit only if every one of them is willing to. Two-Phase Commit, the textbook answer, uses one transaction manager (TM) to collect the votes. If the TM fails right after every RM has said Prepared, the RMs cannot know whether it committed or aborted, so they block until it is repaired. The paper also looks at the non-blocking protocols usually called Three-Phase Commit, and says it knows of none with a complete algorithm proven against a clearly stated correctness condition. Those protocols assume that two processes never both believe they are the coordinator, which an asynchronous system cannot guarantee.

The paper (ACM Transactions on Database Systems 31(1), March 2006, pp. 133-160, from Microsoft Research) treats commit as a consensus problem. It builds on [Paxos](/papers/paxos-made-simple), first described in [The Part-Time Parliament](/papers/paxos-part-time-parliament), and cites the result of [Fischer, Lynch and Paterson](/papers/flp-impossibility-of-distributed-consensus) to explain why progress can only be promised under timeliness assumptions, as in [Dwork, Lynch and Stockmeyer](/papers/consensus-in-the-presence-of-partial-synchrony).

Worth knowing first: Two-Phase Commit, majority quorums, the Paxos ballot structure (phases 1a, 1b, 2a, 2b), and the difference between safety and liveness. The open copy read here is the technical report MSR-TR-2003-96, revised in 2017, which says it differs from the published version only in formatting and in one corrected minor error on the last page.

## Contribution

- **Commit as one consensus per RM.** Paxos Commit runs a separate Paxos instance to choose each RM's decision, Prepared or Aborted. The transaction commits iff every instance chooses Prepared.
- **Shared acceptors and leader.** All instances use the same 2F + 1 acceptors and the same current leader. Each RM plays the role of the ballot 0 proposer for its own instance by sending a phase 2a message directly to the acceptors, which removes the message delay a single consensus on "committed" would need.
- **Two-Phase Commit as a special case.** With F = 0 there is one acceptor and one possible leader, and the two algorithms are isomorphic under the correspondence table in Section 5: the TM is the acceptor/leader, and a Prepared message is a phase 2a Prepared message.
- **A cost analysis.** Messages, message delays and stable-storage writes are counted for Two-Phase Commit, Paxos Commit and a variant called Faster Paxos Commit (Figure 4).
- **Dynamic participants.** A registrar process, whose own Paxos instance chooses the set of RMs that joined, handles transactions whose participants are not known in advance (Section 6).
- **TLA+ specifications.** The appendix specifies the commit problem, Two-Phase Commit and Paxos Commit.

## Methodology

The paper is a protocol design with an informal correctness argument and a counting analysis, not an experiment. The model is processes exchanging messages, each with stable storage. Nodes may fail by stopping, do not perform wrong actions and do not forget their state; messages may be lost or duplicated but not undetectably corrupted. Safety does not depend on timing, and progress does.

Requirements are stated as Stability, Consistency, Non-Triviality and Non-Blocking. Non-Triviality asks for a commit only if the whole network is nonfaulty. The cost model counts inter-node messages, message delays, stable-storage writes and write delays, with and without co-locating processes on the same node. Correctness of Paxos Commit is argued as a corollary of Paxos correctness, and the Appendix gives formal safety specifications in TLA+ (no liveness) with theorems that Two-Phase Commit and Paxos Commit implement the commit specification.

## Findings

These are the paper's own results, with the numbers from Figure 4 and the text.

- **Delays.** In the failure-free case RMs learn the outcome after 4 message delays in Two-Phase Commit, 5 in Paxos Commit and 4 in Faster Paxos Commit, which drops phase 3 by having acceptors send phase 2b messages to every RM. Section 3.2 notes Two-Phase Commit takes three when the TM sits with the initiating RM. If RMs may prepare spontaneously, the paper reaches two delays, which it calls optimal.
- **Messages.** Two-Phase Commit uses 3N - 1 (3N - 3 co-located), Paxos Commit (N + 1)(F + 3) - 4 (N(F + 3) - 3 co-located) and Faster Paxos Commit N(2F + 3) - 1 ((N - 1)(2F + 3) co-located). For N = 5 and F = 1 the co-located figures are 12, 17 and 20.
- **Stable storage.** All three have the same 2 write delays (3 if RMs do not prepare concurrently). Writes total N + 1 for Two-Phase Commit and N + F + 1 for the two Paxos variants, because each acceptor writes once for all instances.
- **Fault tolerance.** With 2F + 1 acceptors, up to F can fail with no effect. With more failures the protocol blocks until F + 1 are working again.
- **Specifications.** TLC checked the Two-Phase Commit theorems for six RMs (50,816 reachable states, a little over a minute on a 1 GHz PC). The Paxos Commit theorem was checked only on configurations the authors call too small to detect subtle errors.
- **Consensus versus commit.** The authors reconcile their result with literature saying commit is strictly harder than consensus: that literature requires commit whenever all RMs are nonfaulty and prepare, even under unpredictable delays, while their Non-Triviality needs a nonfaulty network.

## Critical Analysis

The argument is clear and the F = 0 isomorphism is a good test of the design. Some limits are stated in the paper and some are my reading.

- **No measurement.** Performance is reasoned from message and write counts. The claim that the extra messages cost little rests on the sentence that in modern local area networks messages are cheap and stable-storage writes dominate. No system was built or timed.
- **Failure model.** Crash with recovery from stable storage. The paper does not treat Byzantine faults, and its guarantee holds as long as processes do not make errors executing the algorithm.
- **Correctness is argued.** The Paxos Commit proof is an informal sketch plus a model-checking run on small sizes. The TLA+ specifications cover safety only, and liveness (Non-Blocking) is explained informally.
- **A small inconsistency.** The conclusion says Paxos Commit needs about 2FN more messages than Two-Phase Commit, but Figure 4 gives roughly FN more for Paxos Commit and 2FN more for Faster Paxos Commit.
- **Cost of the extra coordinators.** Section 5 puts the F = 1 cost at about 3N, 4N and 5N messages, so non-blocking costs more messages in every case.

Later literature, not part of the paper. I did not reread these papers for this entry and relied on their catalog entries here. [Spanner](/papers/spanner-globally-distributed-database) replicates each shard with Paxos and then runs two-phase commit across shards, which is a layering of the two protocols rather than the per-RM Paxos instances proposed here. [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) avoids a distributed commit protocol by agreeing on transaction order first. [CockroachDB](/papers/cockroachdb-the-resilient-geo-distributed-sql-database) uses a staging transaction record with Parallel Commits and formalizes that protocol in TLA+. [Percolator](/papers/percolator-large-scale-incremental-processing) runs a client-driven two-phase commit on top of Bigtable. Whether any of them adopts Paxos Commit is not something these entries say, so I draw no such link. The [Sagas](/papers/sagas-garcia-molina-salem) paper is a different answer to long transactions: it gives up atomic commit.

## Further Research

- Measuring Paxos Commit against Two-Phase Commit in a real system, with stable-storage cost, message cost and tail latency under failures.
- Complete proofs and mechanical verification of the Paxos Commit safety theorem at larger configurations, and a formal treatment of the progress properties.
- Handling RMs that fail or are slow, and making abort decisions by leaders (ballots above 0) cheaper in practice.
- A Byzantine-tolerant variant, for which the catalog has [PBFT](/papers/practical-byzantine-fault-tolerance) as background on consensus under that model.
- Failure detectors as the abstraction for the nonfaulty-network condition, as in [Unreliable Failure Detectors](/papers/unreliable-failure-detectors-for-reliable-distributed-systems).

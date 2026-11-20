---
title: "Unreliable Failure Detectors for Reliable Distributed Systems"
summary: Chandra and Toueg add to the asynchronous model an abstract failure detector that may be wrong, classify detectors by completeness and accuracy into eight classes (four up to equivalence), and show that consensus and atomic broadcast become solvable with the eventually strong class when a majority of processes is correct.
researchArea: Distributed Systems
keywords: failure detectors, consensus, atomic broadcast, asynchronous systems, crash failures, completeness, accuracy, partial synchrony
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

We introduce the concept of unreliable failure detectors and study how they can be used to solve Consensus in asynchronous systems with crash failures. We characterise unreliable failure detectors in terms of two properties: completeness and accuracy. We show that Consensus can be solved even with unreliable failure detectors that make an infinite number of mistakes, and determine which ones can be used to solve Consensus despite any number of crashes, and which ones require a majority of correct processes. We prove that Consensus and Atomic Broadcast are reducible to each other in asynchronous systems with crash failures; thus, the above results also apply to Atomic Broadcast. A companion paper shows that one of the failure detectors introduced here is the weakest failure detector for solving Consensus [Chandra et al, 1992].

## Overview

The paper (Journal of the ACM, 1996; a preliminary version appeared at PODC 1991) starts from [FLP](/papers/flp-impossibility-of-distributed-consensus): consensus and atomic broadcast cannot be solved deterministically in an asynchronous system with even one crash failure. The authors locate the root cause in one difficulty, telling a crashed process from a "very slow" one. Earlier escapes were randomization, weaker problems, and models of partial synchrony (Dolev, Dwork and Stockmeyer, cited by the paper, define 32 such models). Chandra and Toueg propose another route: keep the system asynchronous, and give each process a local module that outputs a list of suspected processes, which may add and remove correct processes at will.

The key move is to specify the detector only by abstract properties, not by timeouts or network parameters. An algorithm is then proven against those properties, and runs in any system where a detector with them can be built. A wrong detector may cost liveness but never safety: processes may fail to decide or deliver, but they never decide differently or deliver out of order. This is the vocabulary behind the leader election and view change timers in [Paxos](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm) deployments, and behind detectors such as [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol).

Worth knowing first: the asynchronous model, crash versus Byzantine failures, and the consensus problem (termination, agreement, validity).

## Contribution

- **The failure detector abstraction.** A detector is a function from failure patterns to sets of histories, one suspect list per process and time. Two processes may disagree, and a detector may suspect correct processes forever.
- **Two completeness and four accuracy properties.** Strong completeness: eventually every crashed process is permanently suspected by every correct process. Weak completeness: by some correct process. Strong accuracy: no process is suspected before it crashes. Weak accuracy: some correct process is never suspected. Eventual strong and eventual weak accuracy: the same, after some time.
- **Eight classes.** Strong completeness with the four accuracies gives Perfect (P), Strong (S), Eventually Perfect (◇P) and Eventually Strong (◇S). Weak completeness gives Q, Weak (W), ◇Q and Eventually Weak (◇W).
- **Reducibility.** A reduction algorithm turns one detector into another, so that anything solvable with the second is solvable with the first.
- **Consensus algorithms.** One for S, which tolerates any number of crashes, and one for ◇S, a rotating-coordinator protocol that needs a majority of correct processes.
- **Equivalence with atomic broadcast,** and a refined hierarchy of "repentant" detectors ordered by number of mistakes (Appendix).

## Methodology

The model is a set of n processes with reliable pairwise channels, no bound on message delay, clock drift or step time, crash failures only (a crashed process never recovers), and at least one correct process. Following FLP, an algorithm is a set of automata, and a run fixes a failure pattern, a detector history, and a fair infinite sequence of steps. The paper is theoretical and has no experiments: every claim is a lemma or theorem with a proof, a proof sketch, or an explicit citation. Reliable Broadcast (relay on first receipt) is used as a building block. The conditions "eventually forever" are an idealization the authors justify: in practice they need to hold for long enough for a decision or some progress.

## Findings

- **Weak to strong completeness.** The algorithm of Figure 3 has each process periodically send its suspect set to all, and merge what it receives (removing the sender). It makes weak completeness strong and preserves accuracy (Theorem 3.4), hence P = Q, S = W, ◇P = ◇Q and ◇S = ◇W (Corollary 3.5). Only four classes need study.
- **Consensus with S.** The three-phase algorithm of Figure 5 (n - 1 asynchronous rounds, then vectors exchanged) works with any number of crashes (Theorem 6.1.8), so W and P also solve it.
- **Consensus with ◇S.** The algorithm of Figure 6 uses coordinator (r mod n) + 1 per round, four phases, and acks from ⌈(n+1)/2⌉ processes before a decide is reliably broadcast. It works when f < ⌈n/2⌉ (Theorem 6.2.3), that is, with a majority of correct processes.
- **Majority is necessary.** Consensus cannot be solved with ◇P (hence not with ◇S) when f ≥ ⌈n/2⌉ (Theorem 6.3.1), by a partition argument with two runs that a third run makes indistinguishable.
- **Weakest.** Theorem 6.2.5 and Corollary 6.2.6 state that ◇W_0, the weakest member of ◇W, is the weakest detector for consensus with f < ⌈n/2⌉. The paper attributes the proof to Chandra, Hadzilacos and Toueg (1992), a companion paper, and does not prove it here.
- **Atomic broadcast.** Consensus and atomic broadcast are equivalent in asynchronous systems (Corollary 7.1.7), so every consensus result carries over. Atomic broadcast then runs one consensus per batch of messages (Figure 7).
- **Strictness.** P > S, ◇P > ◇S, P > ◇P, S > ◇S and P > ◇S, while S and ◇P are incomparable (Theorem 8.1, proofs omitted). Terminating Reliable Broadcast needs P (Theorem 8.2).
- **Appendix.** With f ≥ ⌈n/2⌉, consensus is solvable with a strongly m-mistaken detector iff m ≤ n - f, and with a weakly m-mistaken one iff m = 0.

## Critical Analysis

- **Failure model.** Crash-stop only, reliable channels, and no recovery. The paper says consensus and atomic broadcast are also equivalent under Byzantine failures but omits that reduction. Byzantine consensus, as in [Byzantine Generals](/papers/byzantine-generals-problem), is outside the text.
- **Implementation is thin.** Detectors are abstract. The one concrete mechanism is a timeout algorithm (Figure 10, an idea from Dwork, Lynch and Stockmeyer; see [Partial Synchrony](/papers/consensus-in-the-presence-of-partial-synchrony)) with a proof sketch that it implements ◇P in a partially synchronous model with unknown bounds that hold after an unknown GST (Theorem 9.1). No network-level design, no timeout tuning, and no measure of detection time or mistake rate. Footnote 6 notes that no algorithm can implement ◇W in a purely asynchronous system, since it would solve consensus.
- **Efficiency is asserted, not shown.** The authors say a modified ◇S algorithm reaches consensus in two asynchronous rounds in most runs, with no data. The paper states it concerns solvability, not efficiency.
- **Proof coverage.** Section 8 proofs are omitted, and the "weakest" proof is in a companion paper, so those results rest on citations here. I read the full text but did not re-verify the proofs.
- **Practice versus abstraction.** The text compares itself with Isis, which removes wrongly suspected processes, and argues timeouts can then be set nearer the average case.

Later literature, not claimed by the paper:

- **Raft.** The Raft paper (read) uses a follower election timeout and randomized timeouts to resolve split votes, and says safety must not depend on timing while availability does. This mirrors the safety/liveness split, but the Raft paper is not framed in failure detector classes.
- **Gray failure.** Huang et al. (HotOS 2017, abstract and related-work section read) argue failure detectors may not notice problems that afflict applications, and that existing reliable detectors target fail-stop failures; they advocate health monitoring. See [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems).

## Further Research

- Measuring detector quality (detection time, mistake rate) and designing detectors for real networks, as [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol) does with probing and suspicion.
- Detectors for partial and gray failures, beyond up/down suspicion.
- Consensus that does not rely on tuned timeouts, for example [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus).
- The state machine approach built on atomic broadcast: [State Machine Approach](/papers/state-machine-approach-fault-tolerant-services-tutorial).
- Extending the framework to Byzantine failures and crash-recovery, which the paper leaves out.

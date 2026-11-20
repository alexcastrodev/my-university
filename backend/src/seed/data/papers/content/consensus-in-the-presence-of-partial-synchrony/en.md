---
title: "Consensus in the Presence of Partial Synchrony"
summary: The paper that defined partial synchrony, the models between a synchronous and an asynchronous system in which consensus is solvable, and that fixed, for crash, omission and Byzantine faults, the maximum number of faults tolerated, together with matching protocols and lower bounds.
researchArea: Distributed Systems
keywords: consensus, partial synchrony, global stabilization time, fault tolerance, Byzantine faults, distributed clocks, lower bounds
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

The concept of partial synchrony in a distributed system is introduced. Partial synchrony lies between the cases of a synchronous system and an asynchronous system. In a synchronous system, there is a known fixed upper bound Δ on the time required for a message to be sent from one processor to another and a known fixed upper bound Φ on the relative speeds of different processors. In an asynchronous system no fixed upper bounds Δ and Φ exist. In one version of partial synchrony, fixed bounds Δ and Φ exist, but they are not known a priori. The problem is to design protocols that work correctly in the partially synchronous system regardless of the actual values of the bounds Δ and Φ. In another version of partial synchrony, the bounds are known, but are only guaranteed to hold starting at some unknown time T, and protocols must be designed to work correctly regardless of when time T occurs. Fault-tolerant consensus protocols are given for various cases of partial synchrony and various fault models. Lower bounds that show in most cases that our protocols are optimal with respect to the number of faults tolerated are also given. Our consensus protocols for partially synchronous processors use new protocols for fault-tolerant "distributed clocks" that allow partially synchronous processors to reach some approximately common notion of time.

## Overview

The paper by Dwork, Lynch and Stockmeyer (often called DLS) appeared in the Journal of the ACM in April 1988 (volume 35, number 2, pages 288 to 323). A preliminary version was presented at the 3rd ACM Symposium on Principles of Distributed Computing, in Vancouver in 1984. Dwork and Stockmeyer were at IBM Almaden and Lynch at MIT.

The starting point is a gap between two known results. With a known bound on message delay and a known bound on relative processor speed, consensus is solvable for any number of crash faults. Without either bound, the [FLP result](/papers/flp-impossibility-of-distributed-consensus) (and an earlier paper by Dolev, Dwork and Stockmeyer, which the paper cites) shows there is no consensus protocol resilient to even one fail-stop fault. The paper studies the models in between. According to its acknowledgments, the version with unknown bounds came from a question by Joe Halpern: would the impossibility still hold if the bounds exist but are not known in advance?

The paper builds directly on the fault models of the [Byzantine Generals problem](/papers/byzantine-generals-problem), including the 3t + 1 bound for unauthenticated Byzantine faults, and on the clocks of [Lamport's 1978 paper](/papers/lamport-time-clocks-ordering-of-events), which the new distributed clocks make fault-tolerant. Worth knowing first: the safety versus termination distinction, the idea of a t-resilient protocol (correct if at most t of the N processors fail), and the difference between a crash, an omission and a Byzantine fault.

## Contribution

- **Two definitions of partial synchrony.** In the first, a bound Δ on message delay (and, in the processor version, a bound Φ on relative processor speed) exists in every run but is unknown, so the protocol must work whatever it turns out to be. In the second, the bound is known but only holds from some unknown global stabilization time (GST) onward.
- **Safety and termination, separated.** The paper argues that the GST model is equivalent to requiring safety no matter how asynchronously the system behaves, and termination only when the bound eventually holds.
- **Four fault types.** Fail-stop, omission, authenticated Byzantine and unauthenticated Byzantine, each solved in each timing model.
- **A resilience table.** For each combination, the smallest number of processors N for which a t-resilient protocol exists, with upper bounds (protocols) and lower bounds (impossibility proofs).
- **A protocol with locks.** Three basic round-model algorithms, transformed into protocols for every timing model, plus new fault-tolerant distributed clocks.

## Methodology

The paper is entirely theoretical: protocols, lemmas and proofs, with no implementation or measurement. The model follows Dolev, Dwork and Stockmeyer and FLP. Processors are deterministic, possibly with infinitely many states, and in one step either receive messages or send one message to a single processor. Correctness means consistency (no two correct processors decide differently), termination, and unanimity (strong: if all initial values are v, the decision is v; weak: the same only when every processor is correct).

The key device is the basic round model: synchronous rounds in which messages may be lost, except that from some unknown round GST onward messages between correct processors are delivered. Algorithms 1 to 3 solve consensus there. Phases are numbered and phase k belongs to processor p_i when k is congruent to i modulo N. In a trying phase, every processor sends to the owner the values it finds acceptable (not conflicting with its locks). If the owner hears from N - t processors that a value v is acceptable, it broadcasts a lock request, receivers lock v with the phase number and acknowledge, and the owner decides after enough acknowledgments (t + 1 in Algorithm 1, 2t + 1 in Algorithms 2 and 3). A lock-release phase then drops a lock on v when a lock on another value with an equal or higher phase number is reported. Algorithm 2 attaches signed proofs to locks, and Algorithm 3 replaces signatures with an echo-based broadcast primitive adapted from Srikanth and Toueg.

Each timing model then simulates the basic model. With synchronous processors, round r gets a fixed number of steps (when Δ holds eventually) or a growing number (when Δ is unknown, round r gets N + r steps, so rounds from the real Δ onward are long enough and play the role of GST). With partially synchronous processors, the new distributed clocks, built from "ticks" and "claims", give an approximately common notion of time.

## Findings

All of these come from the paper.

- **Resilience (Table I).** For partially synchronous communication, with synchronous or partially synchronous processors, the smallest N for which a t-resilient protocol exists is 2t + 1 for fail-stop and omission faults, and 3t + 1 for both authenticated and unauthenticated Byzantine faults. The synchronous column is t for the first three fault types (any number of faults can be tolerated) and 3t + 1 for unauthenticated Byzantine faults, and the asynchronous column is infinity (no resilience). Authentication does not improve resilience under partial synchrony.
- **With partially synchronous processors and synchronous communication,** the entries are t (fail-stop), between 2t and 2t + 1 (omission), 2t + 1 (authenticated Byzantine, for weak unanimity or when the initial values are signed by a distinguished sender) and 3t + 1 (unauthenticated Byzantine). Without signed initial values, authenticated Byzantine strong unanimity needs N of at least 3t + 1 (Theorem 6.7).
- **Lower bounds.** Theorem 4.3 (fail-stop and omission, N at most 2t) and Theorem 4.4 (authenticated Byzantine, N at most 3t) hold even for weak unanimity and binary values. Theorems 6.5 to 6.7 cover partially synchronous processors. The 3t + 1 bound for unauthenticated Byzantine faults follows from the synchronous result of Lamport, Shostak and Pease.
- **Time.** Algorithms 1 and 2 decide by round GST + 4(N + 1), and Algorithm 3 by GST + 6(N + 1). In the simulations, the time is GST plus a polynomial in N and Δ (and Φ), or a polynomial in N and Δ when Δ is unknown. Message bits are also polynomially bounded. Remark 1 reaches O(t) rounds after GST by having decided processors repeat "Decide v".
- **Halting.** If messages can be lost before GST, any protocol resilient to one fail-stop fault has an execution in which some correct processor must keep sending messages forever.

## Critical Analysis

- **What it does not claim.** There is no implementation, no measurement and no performance comparison. The constants in the clock and time bounds are explicitly not optimized, and the open questions at the end ask whether the rounds after GST can be reduced and whether other problems can be studied in partially synchronous models. It treats single-shot consensus only: there is no replicated log, no state machine and no leader election protocol beyond phases owned by processors in rotation.
- **Where the impossibility proofs are.** The asynchronous impossibility is cited, not reproved. The paper's own lower bounds are in Section 4.3 and Section 6.5, built by indistinguishability scenarios in which messages between two groups are delayed longer than either group needs to decide.
- **Model choices.** Both partial synchrony versions assume Δ holds for all messages after GST, forever. The paper notes this could be weakened to the time needed to decide, but leaves the interval out of the model for convenience.
- **Reading it next to later protocols (my reading).** The locks with phase numbers, rotating owners and quorums of N - t resemble the structure of later protocols, but the paper does not claim to be a state machine replication protocol and says only that similar methods appear in earlier work.
- **Later literature (not part of the paper, checked only against the texts named).** The [PBFT](/papers/practical-byzantine-fault-tolerance) paper, in the version I read, avoids FLP with a weak assumption that message delay does not grow faster than t indefinitely, guarantees safety without synchrony and liveness only with it, and does not cite this paper. The [Autobahn](/papers/autobahn-seamless-high-speed-bft) paper cites it as the origin of the partial synchrony model, describing GST as an unknown time after which synchrony holds, and argues that "GST is an elegant fiction", since real networks are synchronous only in pieces. [Narwhal and Tusk](/papers/narwhal-and-tusk-dag-based-mempool-and-efficient-bft-consensus) separate data dissemination from an eventually synchronous consensus protocol and add a fully asynchronous variant, Tusk. I read only parts of these texts, and did not read the Raft paper or other later GST literature for this analysis.

## Further Research

- Protocols that keep safety unconditional and use timeouts only for liveness, as in [Paxos Made Simple](/papers/paxos-made-simple), which cites FLP as the reason the leader election needs real time or randomness, and, as the Raft analysis in this catalog describes, in [Raft](/papers/raft-understandable-consensus-algorithm).
- Byzantine state machine replication under partial synchrony, such as [PBFT](/papers/practical-byzantine-fault-tolerance), which uses 3f + 1 replicas.
- Behavior during asynchronous periods, which this paper leaves outside the model, as in [Autobahn](/papers/autobahn-seamless-high-speed-bft) and [Narwhal and Tusk](/papers/narwhal-and-tusk-dag-based-mempool-and-efficient-bft-consensus).
- The paper's own open questions: better round counts after GST and other distributed problems in partially synchronous models.

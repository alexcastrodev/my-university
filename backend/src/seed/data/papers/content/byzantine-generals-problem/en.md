---
title: "The Byzantine Generals Problem"
summary: The paper that names and solves the problem of reaching agreement when faulty components may send conflicting information to different parts of a system, proving that oral messages need more than two-thirds of the participants to be loyal and that unforgeable signatures remove that limit.
researchArea: Distributed Systems
keywords: byzantine faults, interactive consistency, agreement, oral messages, signed messages, fault tolerance, majority voting
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Reliable computer systems must handle malfunctioning components that give conflicting information to different parts of the system. This situation can be expressed abstractly in terms of a group of generals of the Byzantine army camped with their troops around an enemy city. Communicating only by messenger, the generals must agree upon a common battle plan. However, one or more of them may be traitors who will try to confuse the others. The problem is to find an algorithm to ensure that the loyal generals will reach agreement. It is shown that, using only oral messages, this problem is solvable if and only if more than two-thirds of the generals are loyal; so a single traitor can confound two loyal generals. With unforgeable written messages, the problem is solvable for any number of generals and possible traitors. Applications of the solutions to reliable computer systems are then discussed.

## Overview

This paper by Leslie Lamport, Robert Shostak and Marshall Pease, from SRI International, appeared in ACM Transactions on Programming Languages and Systems in July 1982 (it was received in 1980). It comes from work on fault-tolerant computers, where the only known way to build a reliable system was to run several processors on the same input and take a majority vote. That works only if every healthy processor sees the same input, and a faulty input unit can show different values to different processors. The paper gives this failure a name and a clean abstract form: a commanding general must send an order to his lieutenants, and some of them, possibly the commander, may be traitors.

It is the origin of the term Byzantine fault, the model where a faulty node may do anything, including lying differently to different peers. The crash-fault algorithms in the catalog, such as [Paxos Made Simple](/papers/paxos-made-simple) and [Raft](/papers/raft-understandable-consensus-algorithm), assume nobody lies. The paper that proves that no deterministic protocol can guarantee agreement in an asynchronous system with even one crash, [Impossibility of Distributed Consensus with One Faulty Process](/papers/flp-impossibility-of-distributed-consensus), points back to this one for the synchronous case. For the ordering side of the same research line, see [Time, Clocks, and the Ordering of Events in a Distributed System](/papers/lamport-time-clocks-ordering-of-events).

Worth knowing first: majority voting, the difference between a message system that can be trusted and one that cannot, and the idea of public-key signatures.

## Contribution

- **The problem statement.** The commander sends an order, and two interactive consistency conditions must hold: IC1, all loyal lieutenants obey the same order, and IC2, if the commander is loyal, every loyal lieutenant obeys his order. Every general's input is distributed this way, so all loyal generals end with the same vector of values.
- **Impossibility with oral messages.** With three generals, no solution works against one traitor, and with oral messages no solution with fewer than 3m + 1 generals copes with m traitors. Agreeing only approximately, for example on an attack time within 10 minutes, is shown to be just as hard.
- **Algorithm OM(m).** A recursive oral message algorithm that works for 3m + 1 or more generals and at most m traitors.
- **Algorithm SM(m).** With unforgeable signed messages it works for any number of generals and at most m traitors.
- **Incomplete networks.** OM extends to 3m-regular graphs, and SM works as long as the loyal generals form a connected subgraph.
- **From generals to computers.** A discussion of what a real system must provide for the message assumptions to hold: timeouts, synchronized clocks and signatures.

## Methodology

The paper is a mathematical argument with no experiments. The oral message assumptions are explicit: every sent message is delivered correctly (A1), the receiver knows who sent it (A2), and the absence of a message can be detected (A3). A traitor cannot forge or block messages between other generals, but can say anything in his own. The impossibility result is argued with two scenarios that look identical to one lieutenant, then lifted to 3m generals by letting each of three generals simulate at most m of the others.

OM(m) has the commander send his value, then each lieutenant act as commander of OM(m - 1) for the others, and finally each lieutenant takes a majority of the values he received. Its correctness follows from a lemma on IC2 and an induction on m (Theorem 1). SM(m) adds a fourth assumption, A4: a loyal general's signature cannot be forged and anyone can check it. Lieutenants collect the set of signed orders they have seen, relay new ones, and apply a deterministic choice function (Theorem 2). Theorem 4 extends this to arbitrary graphs through the diameter of the loyal subgraph.

## Findings

- **The 3m + 1 bound is tight for oral messages.** OM(m) satisfies IC1 and IC2 with more than 3m generals and at most m traitors, and no solution exists with fewer. With three generals and one traitor, signed messages work: a traitorous commander who sends "attack" to one lieutenant and "retreat" to the other is exposed, because his signature appears on two orders.
- **Signatures remove the bound.** SM(m) solves the problem with at most m traitors for any number of generals (it is vacuous with fewer than m + 2).
- **Connectivity.** OM(m, 3m) needs a 3m-regular graph. If the loyal generals form a connected graph, SM(n - 2) solves it for n generals, and with loyal diameter d, SM(m + d - 1) suffices.
- **Cost.** Both OM(m) and SM(m) use message paths of length up to m + 1, which the authors say Fischer and Lynch showed is necessary, and send up to (n - 1)(n - 2) ... (n - m - 1) messages. The conclusion says the solutions are expensive and that this seems inherent to arbitrary failures.
- **Timing is required.** Detecting a missing message needs a bound on delay and clocks synchronized within a fixed error. The paper states that no algorithm can solve the problem if generals may act only at a fixed initial time, on receiving a message, or when a random timer fires (the most general class that cannot build synchronized clocks) and messages can travel arbitrarily fast. It leaves the proof out.
- **Signatures are probabilistic.** Forging cannot be made impossible, only unlikely. The example signature S_i(M) = M * K_i mod P gives a random forger a probability of 1/P.

## Critical Analysis

The paper is the reference point for a whole fault model, and its algorithms are still the clearest way to see why 3f + 1 appears everywhere. The limits are as clear.

- **It assumes a synchronous system.** Timeouts and bounded clock error are built in, which is the setting where [the FLP result](/papers/flp-impossibility-of-distributed-consensus) does not apply. Real networks give no such guarantee.
- **The cost grows steeply with m.** The recursive message pattern is practical only for tiny groups, and the paper says reducing the information sent has not been studied in detail.
- **The informal arguments are admitted to be fragile.** The authors warn readers to be suspicious of nonrigorous reasoning and send them to a separate proof for the three-general case.
- **Condition B is never formalized.** What counts as a "reasonable plan" is left to the choice of the combining function.
- **Problem and application are separate.** How the clocks are kept synchronized is deferred to a future paper, and no implementation is described.

Book versus today: practical systems rarely run OM or SM as written. PBFT and its successors work with partial synchrony and signatures or MACs, use 3f + 1 replicas, and avoid the recursive exchange. The setting where they matter most is where participants do not trust each other, such as blockchains, while crash-fault protocols stay cheaper for systems run by a single operator.

## Further Research

- Practical Byzantine state machine replication, with fewer message rounds and without relying on synchrony for safety, as in [Autobahn](/papers/autobahn-seamless-high-speed-bft) and [Ambulance](/papers/ambulance-saving-bft-through-racing).
- Byzantine databases that serve queries at scale, such as [Pesto](/papers/pesto-high-performance-bft-queries).
- Hybrid models that mix crash tolerance with detection of rare compromise, as in [Pirateship](/papers/pirateship-append-only-ledgers-for-mostly-trusted-execution-environments).
- Byzantine-tolerant clock synchronization, which the paper promises for later.
- Weaker goals than full agreement, such as approximate agreement, and fault models between crash and Byzantine.

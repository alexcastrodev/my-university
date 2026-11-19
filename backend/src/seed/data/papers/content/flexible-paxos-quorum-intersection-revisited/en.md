---
title: "Flexible Paxos: Quorum Intersection Revisited"
summary: Howard, Malkhi and Spiegelman observe that Paxos only needs quorums of different phases to intersect, not all quorums with each other, so the replication phase can use a small quorum if the leader election phase uses a larger one, while safety is preserved.
researchArea: Distributed Systems
keywords: paxos, flexible paxos, quorums, consensus, multi-paxos, leader election, replication
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Distributed consensus is integral to modern distributed systems. The widely adopted Paxos algorithm uses two phases, each requiring majority agreement, to reliably reach consensus. In this paper, we demonstrate that Paxos, which lies at the foundation of many production systems, is conservative. Specifically, we observe that each of the phases of Paxos may use non-intersecting quorums. Majority quorums are not necessary as intersection is required only across phases.

Using this weakening of the requirements made in the original formulation, we propose Flexible Paxos, which generalizes over the Paxos algorithm to provide flexible quorums. We show that Flexible Paxos is safe, efficient and easy to utilize in existing distributed systems. We discuss far reaching implications of this result. For example, improved availability results from reducing the size of second phase quorums by one when the system size is even, while keeping majority quorums in the first phase. Another example is improved throughput of replication by using much smaller phase 2 quorums, while increasing the leader election (phase 1) quorums. Finally, non intersecting quorums in either first or second phases may enhance the efficiency of both.

## Overview

Paxos, introduced in [The Part-Time Parliament](/papers/paxos-part-time-parliament) and retold in [Paxos Made Simple](/papers/paxos-made-simple), has two phases: phase 1 (prepare and promise) and phase 2 (propose and accept). Each phase needs agreement from a quorum of acceptors, and the usual choice is a majority. Safety rests on the fact that any two majorities share an acceptor. In Multi-Paxos, phase 1 runs once to elect a leader and phase 2 runs for every command, so replication is far more frequent than leader election. Related work the paper cites includes the impossibility result of [FLP](/papers/flp-impossibility-of-distributed-consensus), [Chain Replication](/papers/chain-replication-high-throughput-availability), [EPaxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments) and the [Chubby lock service](/papers/chubby-lock-service-loosely-coupled-distributed-systems).

The paper, from VMware Research and the University of Cambridge, appeared at OPODIS 2016. It asks whether the "all quorums intersect" requirement is really needed. The answer is that it is stronger than necessary, and the weaker condition frees the quorum sizes of the two phases from each other.

Worth knowing first: Paxos phases and proposal numbers, the Multi-Paxos leader, and the idea of a quorum system.

## Contribution

- **The observation.** Only a phase 1 quorum (Q1) and a phase 2 quorum (Q2) must intersect. Two Q1s need not intersect each other, and neither do two Q2s. The resulting protocol is called Flexible Paxos (FPaxos). It is strictly more general than Paxos, and FPaxos with intersecting quorums is equivalent to Paxos.
- **Simple quorums.** When every acceptor counts equally, the condition becomes |Q1| + |Q2| > N, so the smallest Q1 for a given Q2 is N - |Q2| + 1. The paper gives an example with 10 nodes: Q2 of 3 nodes and Q1 of 8.
- **Majority and grid examples.** With an even number of acceptors, Q2 can drop from N/2 + 1 to N/2 while Q1 stays a majority. In a grid of N1 columns by N2 rows, Q1 can be one row and Q2 one column, so quorums of the same phase never intersect.
- **A safety argument.** An outline of the proof, plus a TLA+ specification of the single-value protocol model checked against the requirement.
- **A prototype and a sketch of dynamic quorums.** A modification of LibPaxos3, and a discussion of letting leaders announce which quorums they use.

## Methodology

The paper is mostly a reasoning exercise followed by a small experiment. Section 3 re-reads Paxos and identifies which part of the original argument actually uses intersection. Section 4 works through three quorum systems (majority, simple, grid) and counts quorum sizes and tolerated failures. Section 5 gives the safety proof: it takes the smallest proposal number p' greater than p for which a conflicting proposal is sent, picks an acceptor in the intersection of the phase 2 quorum of p and the phase 1 quorum of p', and shows by cases on message order that the conflicting value cannot exist.

For the experiment, the authors modified LibPaxos3, a Multi-Paxos implementation in C over TCP/IP, so that Q1 and Q2 sizes are parameters. Simple quorums were chosen at random and messages went only to a quorum. Each replica was acceptor, learner and possible proposer. Requests were 64 bytes with 10 in flight, all sent first to the same replica. Everything ran in one Linux VM (one core, 1 GB RAM), with mininet simulating a 10 Mbps network with 20 ms round trip time. Each run lasted 120 seconds, and the first and last 10 seconds were discarded.

## Findings

- **Intersection across phases is enough.** For the single-value protocol, the proof needs only that every Q1 intersects every Q2 (equation 3 of the paper). The TLA+ model check of the single-valued protocol with disjoint quorums preserved the safety requirement.
- **Fault tolerance depends on the phase.** With simple quorums FPaxos always handles up to |Q2| - 1 failures. If between |Q2| and N - |Q2| acceptors fail, replication can continue under the current leader, but a new leader cannot be elected until acceptors recover.
- **Grid quorums depend on which nodes fail, not only how many.** In the paper's examples (a 5 by 4 grid of 20 acceptors), if four failures fall in one column, Paxos makes no progress but FPaxos continues until a new leader is needed.
- **Extremes.** |Q1| = N and |Q2| = 1 lets any single acceptor commit but needs every acceptor to elect a leader. |Q1| = 1 and |Q2| = N tolerates f failures with f + 1 acceptors, as earlier work had observed.
- **Prototype numbers.** In Figure 1, LibPaxos3 latency rises and throughput falls as replicas grow from 3 to 14. In Figure 4, smaller Q2 sizes reduce messages, which lowers latency and raises throughput. With 8 replicas and Q2 of size 4, FPaxos handles more failures than Paxos and goes from 42 ms to 37 ms latency and from 198 to 264 requests per second.
- **Part of the gain is not the quorum size.** FPaxos beat vanilla LibPaxos even with identical quorum sizes, because it sends messages only to a quorum instead of to all replicas. The authors also note that Q2 of size 2 cannot elect a leader after two acceptor failures.
- **Dynamic selection.** Safety only needs a Q1 to intersect the Q2s used with lower proposal numbers, so a leader announcing its Q2 could allow, for N = 100f nodes, a fixed Q2 of size f + 1 and tolerance of N - f failures. This is a sketch, and its details are explicitly left out.

## Critical Analysis

The idea is small, correct and very useful, which is why it spread. The limits are in what the paper does and does not show.

- **The proof covers the single-value protocol.** Multi-Paxos is treated by argument, not by a separate proof, and the TLA+ check covers the single-value specification only. Liveness is argued informally, not proved.
- **The evaluation is deliberately naive.** One VM with one core, a simulated 10 Mbps link, random quorum choice and a single workload. The authors say so. The result shows the direction of the effect, not what a production system would gain, and part of the gain comes from sending to fewer replicas.
- **No evaluation of the cost side.** The paper does not measure leader election time or availability under failures with a large Q1, and grid quorums have no experiment at all.
- **The trade-off is real.** A small Q2 means a large Q1, so a leader change needs more live acceptors. The paper states this, but choosing sizes is left to the operator.
- **Dynamic quorums and reconfiguration are only sketched.** The paper says the mechanism must be woven into leader election and points to Vertical Paxos.
- **What the paper does not claim.** It does not claim a new consensus algorithm, a new failure model or tolerance of Byzantine faults, and it does not discuss Raft. Raft, as described in [the Raft thesis](/papers/consensus-bridging-theory-and-practice-raft-thesis), uses majorities for both elections and replication, so the same observation is relevant to it, but that is an inference, not a claim of this paper.

Later literature (not part of this paper): Sougoumarane's blog post, cited by the authors as an independent observation of the same idea, and WPaxos (Ailijiang, Charapko, Demirbas and Kosar, arXiv 1703.08905), whose abstract says it adopts flexible quorums so phase 2 acceptors can sit near their leaders in wide-area deployments. Howard and Mortier's "Paxos vs Raft" (arXiv 2004.05074) compares the two algorithms and finds they differ only in leader election.

## Further Research

- Proofs and model checking for Multi-Paxos with flexible quorums, and for dynamically chosen quorums.
- Quorum systems from the replication literature (weighted voting, hierarchies, crumbling walls, which the paper lists) applied to consensus.
- Combining flexible quorums with other variants, such as Fast Paxos, EPaxos and Vertical Paxos reconfiguration.
- Experiments on real clusters, with leader failure, slow acceptors and failures correlated by rack or data center.
- Adding configurable phase quorums to existing implementations of Paxos-family and Raft-family systems.

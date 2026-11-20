---
title: "Zyzzyva: Speculative Byzantine Fault Tolerance"
summary: Zyzzyva lets replicas execute a request in the order the primary proposes and answer the client at once, and moves the final decision to the client, which accepts the reply only when 3f+1 responses (or a commit certificate from 2f+1 replicas) prove the order is stable. Fault-free, it reaches three one-way message delays and, with batching, 86K ops/s against PBFT's 59K.
researchArea: Distributed Systems
keywords: byzantine fault tolerance, speculative execution, state machine replication, commit certificate, view change, client-driven agreement
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

We present Zyzzyva, a protocol that uses speculation to reduce the cost and simplify the design of Byzantine fault tolerant state machine replication. In Zyzzyva, replicas respond to a client's request without first running an expensive three-phase commit protocol to reach agreement on the order in which the request must be processed. Instead, they optimistically adopt the order proposed by the primary and respond immediately to the client. Replicas can thus become temporarily inconsistent with one another, but clients detect inconsistencies, help correct replicas converge on a single total ordering of requests, and only rely on responses that are consistent with this total order. This approach allows Zyzzyva to reduce replication overheads to near their theoretical minima.

## Overview

[The Byzantine Generals Problem](/papers/byzantine-generals-problem) defined arbitrary faults, and [PBFT](/papers/practical-byzantine-fault-tolerance) (OSDI 1999) made them tolerable in an asynchronous network. This paper, from the University of Texas at Austin, was presented at SOSP 2007 (Stevenson, October 14 to 17, pp. 45 to 58). Its starting point is that PBFT-style agreement still costs a three-phase protocol before replicas answer. The authors also say the state of the art was "distressingly complex": quoting the HQ paper, the best choice among PBFT, Q/U and HQ depended on contention, batching, the number of replicas and the value of f, so a designer had to pick per workload. That paper also expected PBFT to suffer from "the quadratic number of messages" as f grows, which Zyzzyva quotes.

The proposal is to move the "output commit" to the client. Replicas execute the order proposed by the primary immediately, without talking to each other. The reply carries a digest of the request history, so the client can tell whether it is stable, meaning guaranteed to be committed eventually at all correct replicas.

Worth knowing first: PBFT's pre-prepare, prepare and commit phases, [linearizability](/papers/linearizability-correctness-condition-concurrent-objects) as the guarantee clients see, the eventual-synchrony model of [Dwork, Lynch and Stockmeyer](/papers/consensus-in-the-presence-of-partial-synchrony) (the paper's liveness assumption), and [Paxos](/papers/paxos-part-time-parliament) (see also [Paxos Made Simple](/papers/paxos-made-simple)), since the paper says its fast agreement is based on work on fast Paxos.

## Contribution

- **Speculation with a client-side check.** Replicas append the ordered request to their history, execute it and send a spec-response with the history hash. A request completes at the client in one of two ways, and the agreement sub-protocol never needs more than two phases within a view.
- **Fast case.** With 3f+1 mutually consistent responses the client acts at once. This takes three one-way delays on the critical path (PBFT and HQ: 4, Q/U: 2, per Table 1).
- **Two-phase case.** With 2f+1 to 3f matching responses, the client builds a commit certificate (2f+1 signed responses) and sends it to the replicas, which answer with local-commit. The client completes after 2f+1 local-commits.
- **Fewer than 2f+1 responses.** The client resends the request to all replicas, which forward it to the primary (confirm-req) and start a view-change timer if it is not ordered. If two spec-responses carry conflicting order-req messages, the pair is a proof of misbehavior sent to the replicas, which start a view change.
- **A different view change.** A replica that suspects the primary multicasts "I hate the primary" but keeps participating, and commits to the view change only after f+1 such votes. The new-view history may include a request supported by order-req messages from f+1 replicas even without a commit certificate, because a request that completed with 3f+1 responses has no commit certificate anywhere.
- **Zyzzyva5.** With 5f+1 replicas, the three-delay path survives f faulty non-primary replicas.

## Methodology

The paper gives the protocol, then proof sketches for two properties, with full proofs in an extended technical report that this entry did not read. Safety (saf): if a request with sequence number n and history h_n completes, any request completing with n' >= n has a history with h_n as a prefix. Liveness (liv): any request from a correct client eventually completes. Safety holds in any asynchronous network, with any number of faulty clients and up to f faulty replicas. Liveness needs periods in which messages are processed within some fixed, possibly unknown, delay.

The prototype uses MACs instead of signatures (signatures stay in client retransmissions and view changes), 2f+1 execution replicas with the rest as witnesses, batching, read-only requests, single execution response, preferred quorums (not used in the measurements) and out-of-order caching. Tests ran on 3.0 GHz Pentium-4 machines with Linux 2.6, MD5 MACs, and Castro et al.'s 0/0, 4/0 and 0/4 micro-benchmarks, mostly with f = 1. PBFT and HQ ran from their original implementations, with throughput scaled up by 9% for SHA-1 against MD5. Q/U throughput is its published peak, scaled by 7.5% for the clock, and Q/U latency comes from a simple best-case implementation the authors wrote.

## Findings

These are the authors' results; the bullets say where the number comes from.

- **Throughput, 0/0, no batching (text).** Zyzzyva's peak is 2.7 times PBFT's, with PBFT doing about 2.2 times more crypto operations and about 3.7 times more messages.
- **Throughput with batch size 10 (text).** Zyzzyva and Zyzzyva5 peak at 86K ops/s, which the authors read as 12 µs of protocol overhead per batched request at the primary. PBFT reaches 59K, a 45% gap. Zyzzyva has over 3 times Q/U's reported peak and over 9 times HQ's measured throughput, and is within 35% of an unreplicated server.
- **Latency (Figure 4, graph reading only).** Zyzzyva and Zyzzyva5 are lower than PBFT and HQ, and HQ's bars are the tallest, around 0.7 ms for 0/0. The text says Q/U, in its best case, has even lower latency at low contention. The text gives no latency numbers.
- **Fault scalability.** Without batching, Zyzzyva needs 2 + (3f+1) crypto operations per request at the bottleneck and PBFT 2 + (10f+1). The message counts in Figure 7 come from an analytical model, and the paper notes that primary message counts grow with f for Zyzzyva, Zyzzyva5 and PBFT, but not for Q/U and HQ.
- **With f non-primary replicas not responding (text).** For f = 1 and no batching, Zyzzyva and Zyzzyva5 give 1.8 and 2.6 times PBFT's throughput. With batch size 10, PBFT is 15% better than Zyzzyva, whose crypto cost is 16% higher, while Zyzzyva5 stays 43% above PBFT. One faulty replica already forces the two-phase path, and per-batch crypto cost grows from 2 + (3f+1)/b to 3 + (5f+1)/b.

## Critical Analysis

What the paper says about its limits: the fast case needs all 3f+1 responses, so one slow or faulty replica forces the commit-certificate round, and its numbers are optimized for the failure-free case. Zyzzyva5 buys back speed with 2f more replicas. A faulty primary "can significantly prevent progress" and is handled only by replacement.

Points that are a reading of the evidence, not claims of the paper:

- **The failure evaluation is narrow.** It measures replicas that fail to respond, not Byzantine replicas actively misbehaving, and there are no measurements of view changes, a faulty primary or the client timeout that precedes the commit round, so the cost of the slow path with active attackers is unmeasured. Figure 7 is a model, not a measurement.
- **The baselines differ in kind.** Q/U enters through published throughput and a best-case latency implementation, and HQ and PBFT numbers are rescaled by the authors for hardware and hash differences.
- **Internal inconsistency in the cost formulas.** Table 1 lists PBFT's bottleneck MAC cost as 2+(8f+1)/b and Zyzzyva's as 2+3f/b, while Sections 5.3 and 5.4 write 2+(10f+1) and 2+(3f+1)/b. The paper does not explain it, and only the extended report has the details.
- **Complexity moved, not removed.** The view change gains a phase, a weaker rule for which requests enter the new history, and the paper itself calls one consequence "a curiosity".

Later literature, not part of the paper. In December 2017, Abraham, Gueta, Malkhi (VMware Research) with Alvisi, Kotla and Martin published the arXiv note "Revisiting Fast Practical Byzantine Fault Tolerance" (1712.01367). Its abstract says: "we observe a safety violation in Zyzzyva and a liveness violation in FaB". For Zyzzyva it gives two scenarios with four replicas, one Byzantine, and three views, where the conflict appears in the first log slot: one challenges preferring a commit certificate over f+1 prepares, the other preferring the longest commit certificate. The note calls its description of Zyzzyva "skeletal" and sends readers to the CACM version for the details. I read the note's Zyzzyva section but did not check its scenarios against the SOSP text or the extended report, nor read any reply or correction, so I cannot say how they map onto the 2007 protocol. Later catalog entries take a different route to BFT throughput: per their summaries, [Autobahn](/papers/autobahn-seamless-high-speed-bft) and [Narwhal and Tusk](/papers/narwhal-and-tusk-dag-based-mempool-and-efficient-bft-consensus) separate data dissemination from ordering, with Autobahn ordering through PBFT-style consensus.

## Further Research

- Measure the slow path under active Byzantine behavior, including view changes, which the paper never does.
- Quantify how the client timer that precedes the commit certificate affects latency when one replica is slow.
- Read the extended ACM TOCS version (27(4), 2009) and the extended report for the full proofs, and re-check the 2017 note's scenarios against them.
- Weigh Zyzzyva5's 5f+1 replicas against the slow path of the 3f+1 version.

---
title: "QuePaxa: Escaping the tyranny of timeouts in consensus"
summary: QuePaxa is a crash-fault consensus protocol that stays live under asynchrony by randomizing proposal priorities, commits in one round trip when its designated leader goes first, and replaces view-change timeouts with short hedging delays and adaptively chosen leaders.
researchArea: Distributed Systems
keywords: consensus, state machine replication, asynchronous consensus, hedging, timeouts, multi-armed bandit, fast path
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Widely deployed state machine replication (SMR) protocols such as Multi-Paxos and Raft elect one leader at a time, because simultaneous proposers interfere destructively, and they replace a failed leader through timeout-triggered view changes. The authors call the resulting problems the tyranny of timeouts. Liveness holds only under partial synchrony, so high delay, asymmetric connectivity or a denial-of-service (DoS) attack on the leader can slow or halt progress. Timeouts must be set conservatively large to avoid false view changes, which makes recovery slow. And they need manual tuning, so a leader that is slow but not slow enough to time out can stay in charge while faster ones exist.

This SOSP 2023 paper (Koblenz) comes from EPFL, ISTA and Mysten Labs, Trinity College and UCL. It asks whether a practical SMR protocol can keep the normal-case efficiency of a leader-based design without depending on timeouts. The answer is QuePaxa, for crash faults only, with n ≥ 2f+1 replicas.

Key terms: **proposers** drive consensus and **recorders** passively store state, and every replica plays both roles. An **interval summary register (ISR)** is the constant-space structure a recorder keeps. The **fast path** is a one-round-trip commit by a designated leader. A **hedging schedule** staggers when proposers activate, and **multi-armed bandit** (MAB) tuning picks leaders and delays.

Worth knowing first: quorums and leader-based SMR from [Paxos Made Simple](/papers/paxos-made-simple), timeout-driven leader election as in [Raft](/papers/raft-understandable-consensus-algorithm), and the FLP result, which says deterministic consensus is impossible in an asynchronous network and which QuePaxa sidesteps with randomness. Two pairings of mine, not the paper's: the stalls caused by false view changes echo the self-sustaining loops of [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems), and [Ambulance](/papers/ambulance-saving-bft-through-racing), a later paper, attacks the same timeout problem for Byzantine faults.

## Contribution

- **A randomized asynchronous core.** The abstract protocol runs rounds on an idealized threshold broadcast (tcast). Each replica attaches a random priority to its proposal, and three tcast steps yield existent (E), common (C) and universal (U) proposal sets, with U ⊆ C ⊆ E across all replicas. A replica decides when the best proposal in E equals the best in U, and otherwise carries the best of C into the next round. The authors argue that a round decides with probability above 1/2 against a content-oblivious network adversary, one that can delay and reorder messages but cannot see contents or replica memory (TLS between replicas satisfies this), so expected termination takes under two rounds.
- **Proposers and recorders.** The concrete protocol has four phases per round, with step = 4 × round + phase, and each step costs one round trip between a proposer and a majority of recorders. A recorder is an ISR: it keeps the first value of the current step and the integer maximum of the prior step, and drops obsolete values. A proposer that sees a higher step catches up to it. Concurrent proposers therefore cooperate, while in Paxos a second prepare can interrupt the first proposer indefinitely.
- **A one-round-trip fast path.** In the first round of a slot, the designated leader attaches a reserved top priority. If its proposal reaches a quorum first, it decides after one round trip, like an already-prepared Multi-Paxos or Raft leader. Only the first round is leader-based, because a strong scheduling adversary can always make a leader round fail, and later rounds are leaderless.
- **Hedging instead of timeouts.** Proposers form a schedule: the leader has delay zero, the next proposer delay δ, the next 2δ, and so on. A proposer proposes only if it has not seen progress. A δ that is too small causes redundant effort but never lost liveness, and with δ within a constant factor of the real delay the authors argue only a constant number of proposers activates per step, keeping O(n) communication.
- **Auto-tuning.** Leader and schedule choice is treated as a MAB problem. Fixed-length epochs each have a stable leader, the first 2n+1 epochs rotate leaders round-robin, giving each replica two, and afterwards replicas are sorted by observed average epoch completion time. QuePaxa keeps watching the leader and moves on if it falls below the next one in the schedule.
- **A LAN optimization.** Submitters broadcast batches to all replicas and consensus agrees on batch IDs such as hashes, which cuts leader bandwidth. The authors note that [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) and Rabia use similar data-center-specific optimizations.
- **Assurance.** Appendices B and C prove the abstract and concrete protocols, and Promela models were checked for safety with the SPIN model checker.

## Methodology

The prototype is written in Go 1.18, 4,368 lines by CLOC, over TCP with Protobuf and gRPC, with batching in submitters and proposers and with pipelining, but without reconfiguration. The baselines are Multi-Paxos, Raft, EPaxos and Rabia. The authors report that the existing Multi-Paxos and EPaxos code does not handle leader failure correctly (a new leader skips the prepare phase), so EPaxos appears only in normal-case runs and the failure experiments use their own new Multi-Paxos (2,743 lines) and Raft (2,802 lines).

Experiments run on Amazon EC2, with c4.4xlarge replicas and c4.2xlarge submitters, in a LAN setting (North Virginia) and a WAN setting (Tokyo, Mumbai, Singapore, Ireland, São Paulo). The application is a string-to-string key-value store with 17-byte requests and open-loop Poisson submitters. Each run lasts one minute and is repeated 3 times. The experiments cover normal-case latency and throughput, scalability from 3 to 13 replicas, a simulated network adversary (5 replicas, WAN), the effect of hedging delay or timeout on liveness and recovery (5 replicas, 180 ms average round-trip time, constant 25k commands per second, leader crashed at 15 s), and best-leader discovery on five heterogeneous machines in Oregon at 80k commands per second. The model-checking baseline is 2 proposers, 3 recorders and two rounds: the first Promela model was verified exhaustively in under three minutes, while the second, with separate recorder processes, took about 24 hours with bitstate hashing, which may leave some paths unexplored.

## Findings

These are the authors' reported results.

- **Normal case, LAN.** QuePaxa saturates at 584k commands per second under a 5.8 ms median latency bound, against 400k under 5.6 ms for Multi-Paxos. The authors credit the batch-ID optimization. EPaxos without execution reaches 699k (2% conflicts), which they attribute to partitioning commands across instances, a technique orthogonal to this work.
- **Normal case, WAN.** The abstract gives 250k commands per second, comparable to Multi-Paxos. EPaxos with execution has a median latency about 400 ms higher than QuePaxa in the 50k to 200k range, and without execution about 60 ms higher in the 0 to 150k range. Rabia's WAN throughput falls under 10 commands per second at over 2 s latency, which the authors tie to its assumption that message delay is small relative to the gap between requests.
- **Scalability.** QuePaxa falls from 584k at 3 replicas to 467k at 13 (about 20%) and stays on average 35% above Multi-Paxos, a gap that disappears when the batch-ID optimization is turned off. EPaxos crashes above 5 replicas because of a hard-coded array.
- **Simulated attack.** The adversary adds up to 500 ms of egress latency to a minority of replicas in 5 s epochs. QuePaxa sustains at least 75k commands per second under a 380 ms median latency, while Multi-Paxos and Raft saturate at 2.5k.
- **Hedging versus timeouts.** QuePaxa keeps 25k commands per second whatever the hedging delay, even below the 180 ms round-trip time, and its cost is extra messages from multiple proposers. Multi-Paxos and Raft lose throughput and then liveness as the timeout nears the round-trip time, and need about 1.8 times that value (above 330 ms they deliver 25k).
- **Recovery.** After a leader crash QuePaxa recovers in 303 to 473 ms for every hedging delay. Multi-Paxos and Raft take orders of magnitude longer with timeouts too close to the round-trip time, never stabilize below 200 ms, and with delays above 500 ms recover in about one round trip plus the timeout.
- **Best leader.** Starting with the weakest machine (t2.large) as leader, Multi-Paxos and Raft stay at 5.2 ms because it never times out. QuePaxa converges to the best leader after 4 seconds and reaches 3.8 ms, 1.4 ms lower.

## Critical Analysis

The idea is a clean separation: randomness only ranks proposals, so the leader becomes a privilege and not a requirement. The paper concedes several limits.

- **Hedging is not free.** A δ that is too small costs redundant proposers, lower fast-path success and, in the worst case, O(n²) communication. A strong adversary can also defeat a leader-based round, so liveness under attack rests on the slower leaderless rounds.
- **Scope.** The protocol covers crash faults only, assumes a content-oblivious adversary (side channels are out of scope) and the prototype has no reconfiguration. The leader stays a bottleneck, which the authors link to the 20% throughput drop at 13 replicas, and EPaxos-style partitioning, flexible quorums, better schedules and re-exploring non-leader replicas are left as future work.
- **Complexity and review.** The authors say adaptivity costs some protocol complexity, and that the appendices (priorities, proofs, model checking, the Rabia comparison) did not get the same level of peer review as the main paper.

The following points are a reading of the evidence, not claims of the paper.

- **The LAN gain does not come from the consensus core.** The 584k versus 400k gap comes from batch IDs, and with that optimization off the two protocols are about equal. The text does not report Multi-Paxos or Raft given the same optimization, so the core is shown to match them, not to beat them.
- **The failure baselines are the authors' own.** The new Multi-Paxos and Raft were written for these experiments, and the paper shows how implementation-sensitive recovery is: Multi-Paxos recovery explodes at a timeout 100 ms higher than Raft's, which the authors blame on threading design. Extrapolating the paper's own formula (round trip plus one timeout) to a well-tuned timeout of about 330 ms gives roughly 500 ms, the same order as QuePaxa's 303 to 473 ms. The main advantage is then that small delays are safe, more than faster recovery at equal settings.
- **The attack is simulated and random.** Figure 8's caption describes random attacks on a minority of replicas, in one 5-replica WAN setting. The motivating threat in Section 2, an attacker who finds each new leader by traffic analysis and refocuses, is not described as tested, and no real DoS or route hijack is run.
- **Adaptation is tested on static differences.** Section 1 promises responsiveness to time-varying conditions, but the one auto-tuning experiment has fixed machine heterogeneity, five replicas, one starting leader and one region. The epoch length is not given, and nothing is said about convergence at other cluster sizes or after conditions change. The exploration phase is also described as 2n+1 epochs with two per replica, which adds up to 2n.
- **The liveness bound and the prototype differ.** The probability above 1/2 per round assumes high-entropy priorities, while the prototype uses a low-entropy random value plus the replica ID as a tiebreaker (Appendix A.1), a case for which the authors say the analysis needs adjustment. The adjusted probability is not given, and the model checker covers safety only, on a small configuration.
- **Reporting details.** The text gives no spread across the three one-minute runs and does not describe stable storage in the measured runs. Figure 9's caption names two panels, while the text uses a third (steps per slot) as a proxy for bandwidth cost. EPaxos is stated as 16.5% above QuePaxa, yet 699k over 584k is about 19.7%, and 16.5% is the gap measured against EPaxos. Rabia's WAN collapse is against a protocol built for LANs, which the authors acknowledge, so it says little about randomized consensus in general.

## Further Research

- Flexible quorums on the fast path, better hedging schedules (starting the first two proposers together, or assigning delays from measured timings) and periodic re-exploration of non-leader replicas, all of which the authors leave as future work.
- Combining QuePaxa with partitioned or multi-leader designs and with the goals the paper sets aside, such as WAN locality, erasure coding and Byzantine tolerance, where [Ambulance](/papers/ambulance-saving-bft-through-racing) is one later attempt at the timeout problem.
- Testing the adaptive parts under an attacker that tracks the leader and under changing conditions, with convergence measured across cluster sizes and the hedging overhead reported in bytes.
- Comparing the built-in fast path with the shim approach of [Jetpack](/papers/jetpack-consensus-made-generally-fast), a later paper that adds a one-round-trip path around an unmodified protocol, to see what each route costs.

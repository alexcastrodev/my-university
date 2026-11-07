---
title: "Ambulance: Saving BFT through Racing"
summary: Ambulance replaces timeouts in Byzantine state machine replication with a race between replicas, where the leader runs a shorter protocol and the others build the certificates they need for recovery, so a slowdown is detected by missing protocol progress instead of by a clock.
researchArea: Distributed Systems
keywords: byzantine fault tolerance, state machine replication, slowdown tolerance, protocol-rigged racing, hedging, timeouts, threshold signatures
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Distributed-trust systems, such as key recovery services and blockchains, keep a totally ordered log with Byzantine fault tolerant (BFT) state machine replication (SMR), even when up to f of 3f+1 replicas misbehave. This OSDI 2026 paper, from UC Berkeley, Cornell University, Sei Labs, the University of Stavanger and Duke University, asks what happens when the leader is merely slow, not crashed. A slowdown is a correct replica whose service rate falls below its baseline because of fsync stalls, garbage collection, data synchronization or network problems. The authors report that Sei, etcd and Neo4j have seen slowdowns of over seven seconds.

The usual detector is a timeout, and the authors call it destructive (an aggressive one triggers leader changes whose proposals interfere with the old leader's) and blocking (a conservative one leaves the system idle). They report production defaults between 2 s and 30 s, and a recommendation of at least ten times the round-trip time. Hedging staggers proposals by a time delay, and asynchronous protocols let everyone propose but pay in the common case.

The key terms are protocol-rigged racing, the sports car certificate (the leader's non-equivocation proof) and the truck certificate (a replica's slower one), the race cutoff, the recovery path, and motorization, which reuses the data layer of Autobahn for throughput. The USENIX page lists the paper as a Distinguished Artifact Award winner.

Worth knowing first: SMR and quorum intersection from [Paxos Made Simple](/papers/paxos-made-simple), timeout-driven leader election as in [Raft](/papers/raft-understandable-consensus-algorithm) (crash faults only, where this paper needs 3f+1 replicas and signatures), and the two phases of PBFT, non-equivocation then persistence.

## Contribution

- **Two conditions for detection.** A slowdown detector should be cooperative, so concurrent proposals do not interfere, and productive, so the waiting contributes useful work. A third requirement is not to accuse healthy replicas. Timeouts and hedging fail the second condition.
- **Protocol-rigged racing.** Every replica proposes in its own lane and races the leader, but only by executing steps it needs anyway. The leader lane builds a sports car certificate in two message delays with an all-to-all exchange. A replica lane builds a truck certificate in three, with a linear pattern. The race ends at a replica once it has seen 2f+1 truck certificates, and the leader wins if its certificate arrives before that cutoff.
- **Recovery without a leader.** Replicas can disagree on who won, so recovery first picks a value per lane: the leader's value if a sports car certificate exists, otherwise the replica's own truck certificate, backed by a no-commit or no-lock certificate. An optional race exclusion phase stops a Byzantine replica from equivocating between the two lanes, and a persistence phase follows.
- **Late, random lane election.** Only after 2f+1 lanes have persisted do replicas pick a winner, using a threshold signature hashed modulo n. All replicas agree on it, and nobody can predict it, so a network adversary cannot target the winner in advance. If the chosen lane is not ready, the next view reruns recovery.
- **Latency and guarantees.** The normal case takes three message delays, like PBFT. Under a slowdown the authors give an expected 9.5 message delays if the leader never proposes and 10.5 otherwise. They prove safety, and termination with probability 1, with each view succeeding with probability above 2/3. Slots are pipelined as in Autobahn.

## Methodology

The authors built a Rust prototype on the open-source Autobahn codebase, with Tokio TCP, RocksDB and ed25519 signatures. It includes their implementation notes except signature aggregation. The baselines are Autobahn (timeouts), ParBFT2 (hedging, with HotStuff as the optimistic path) and SMVBA (asynchronous), and the authors say they validated the Autobahn and ParBFT2 results with the respective authors.

Experiments ran on AWS EC2 with 4 replicas across us-east1, us-east2, us-west1 and us-west2 (round-trip times of 20 to 72 ms), 512-byte no-op transactions and 500KB batches. The common-case runs last 60 seconds under increasing load. For slowdowns, one replica is paused from t = 3 s for 1, 2, 5, 7 or 10 seconds. Each point is the median latency over a 500 ms window across 5 runs. Autobahn runs with a timeout above and one below each duration, and ParBFT2 runs only its pessimistic path with a 75 ms hedging delay. A third setting is a Sei production deployment with 40 replicas in 20 regions, compared with Sei's own Autobahn over 24 hours.

## Findings

These are the authors' reported results.

- **Common case.** Ambulance peaks at 214k tx/s, the same as Autobahn, with 205 ms latency against 203 ms. ParBFT2 reaches 167k tx/s and 382 ms, and SMVBA 50.6k tx/s and 462 ms. The authors tie this to good-case consensus latency (three message delays for Ambulance, five for ParBFT2, six for SMVBA) and to weaker data layers and missing pipelining.
- **1 s slowdown.** Ambulance peaks at 510.4 ms. Autobahn reaches 796.1 ms with a 500 ms timeout and 889.5 ms with a 2 s one, SMVBA 731 ms and ParBFT2 1.58 s.
- **2 s slowdown.** Ambulance peaks at 633.4 ms, against 1.37 s and 1.89 s for Autobahn with 1 s and 5 s timeouts, 766 ms for SMVBA and 1.58 s for ParBFT2.
- **5, 7 and 10 s slowdowns.** Ambulance peaks at 787.7, 810 and 932 ms, growing slowly as more views fail. That is 3.1× to 10.8× better than Autobahn. SMVBA closely tracks it, and ParBFT2 stays at 1.58 s.
- **Summary claims.** Peak latency is 1.6× to 3.0× lower than Autobahn for 1 to 2 s slowdowns and up to 10.8× lower for longer ones, and 1.7× to 3.1× lower than ParBFT2.
- **Production.** Under 180k load, with slowdowns about once every thousand slots, the median is 244 ms against 242 ms for Autobahn, and p99 is 662 ms against 1.27 s (1.92× lower).

## Critical Analysis

The idea is clean, since the racing path reuses work that BFT needs anyway. The paper concedes several limits.

- **The head start is small.** By default the leader leads by one message delay. In a LAN, where delays are tiny, a healthy leader may be called slow and trigger recovery needlessly, so the authors propose dummy phases or a time-based delay (Appendix C), which they argue stays productive because replicas still build certificates meanwhile.
- **ParBFT2 is not fully tested.** Because of bugs in its switching logic, the authors ran only its pessimistic path and injected no slowdown, and say this does not reflect its common-case latency.
- **Matching, not beating, asynchronous protocols.** Ambulance tracks SMVBA during slowdowns, and longer slowdowns raise the chance of extra views. Signature aggregation is left out, and the authors say it matters only at large n.

The following points are a reading of the evidence, not claims of the paper.

- **One kind of slowdown.** The experiments pause a single replica in a 4-node cluster, once. They include no partial slowdowns, repeated ones, Byzantine replicas or adversarial scheduling, so safety and liveness rest on the Appendix B proofs.
- **Point values.** Peak latency is the maximum of a median over 500 ms windows, and the text gives no spread across the 5 runs. A gap such as 633.4 ms against SMVBA's 766 ms is hard to judge without it.
- **Confounded baselines.** ParBFT2 and SMVBA use another data layer and no pipelining, and ran at 10k load against 100k for Ambulance. The authors attribute the 1.3× throughput gap mainly to the data layer, so Autobahn, which shares the code, is the clean comparison. The 1.7× to 3.1× figure against hedging rests on a pessimistic-only ParBFT2 that stays at 1.58 s for every duration.
- **Static timeouts.** Autobahn uses fixed production defaults. The related work notes that Aardvark-style performance monitoring gives partial protection, but it is not evaluated.
- **Thin scale and production evidence.** Controlled runs use n = 4, and n = 40 appears only in one 24-hour run on the co-authors' deployment, where p99 is dominated by slowdowns. The text gives neither their number nor their durations, nor how often a healthy leader loses the race.

## Further Research

- Choosing the leader's head start per deployment, with dummy phases or delays, and measuring how often healthy leaders are misclassified.
- Signature aggregation, which the authors say cuts communication by a factor of n, with throughput measured at tens of replicas.
- A hedging comparison once ParBFT2's optimistic-pessimistic switching works, which the authors say they are resolving with its authors.
- A formal slowdown-tolerance property for BFT, like Copilot's s-slowdown-tolerance for crash faults, tested with partial, repeated and Byzantine slowdowns.

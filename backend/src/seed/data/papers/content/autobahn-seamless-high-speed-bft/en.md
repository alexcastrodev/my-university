---
title: "Autobahn: Seamless high speed BFT"
summary: Autobahn separates data dissemination, where every replica grows its own certified chain, from a PBFT-style consensus that orders snapshots of those chains, so a stalled leader leaves no backlog that keeps hurting latency after progress resumes, while latency stays close to traditional BFT and throughput close to DAG protocols.
researchArea: Distributed Systems
keywords: byzantine fault tolerance, state machine replication, partial synchrony, dag-based bft, data lanes, hangovers, seamlessness
version: 1.0
updatedAt: 2026-11-07
---

## Overview

Byzantine fault tolerant (BFT) state machine replication (SMR) gives clients the abstraction of one trusted, always available server even when up to f of 3f+1 replicas misbehave. It sits under blockchains, digital-currency designs and distributed-trust systems. Deployed protocols assume partial synchrony: they are always safe, but progress is promised only after an unknown Global Stabilization Time (GST), which real systems imitate with growing timeouts. The authors argue that real deployments are partially synchronous in a piece-wise way, with good intervals interrupted by blips (a timeout fires, a leader is replaced, progress stalls), and that existing protocols must choose between low latency in good intervals and graceful recovery from blips.

This SOSP 2024 paper (Austin), by Neil Giridharan and Natacha Crooks (UC Berkeley), Florian Suri-Payer and Lorenzo Alvisi (Cornell University) and Ittai Abraham (Intel Labs), names the damage a blip leaves behind a hangover. Traditional protocols such as HotStuff tie data dissemination to ordering, so a stall builds a backlog that takes time to work off. DAG-based protocols such as Bullshark recover better but need up to 12 message delays (mds) to commit.

Key terms: a **good interval** is synchronous with a correct leader, and a **gracious** one also has every replica correct. A **hangover** is a performance degradation caused by a blip that outlives the blip. A protocol is **seamless** if it has no protocol-induced hangovers and adds no mechanism that makes it newly susceptible to blips. Autobahn's data layer is made of **lanes**, one per replica, built from **cars**, and its consensus orders **cuts** of lane tips.

Worth knowing first: SMR and quorum intersection from [Paxos Made Simple](/papers/paxos-made-simple), and timeout-driven leader election as in [Raft](/papers/raft-understandable-consensus-algorithm). Both handle crash faults only and the paper cites neither, since its consensus references are PBFT and HotStuff. Also [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order), which the paper cites as the example of separating dissemination from ordering for crash failures.

## Contribution

- **Hangovers and seamlessness.** Seamlessness needs responsive dissemination (progress at the pace of the network) and a streamlined commit (every disseminated proposal commits in bounded time, at a cost independent of how many transactions are waiting). The data layer must offer instant referencing, non-blocking sync (no data fetching before voting) and timely sync (fetching finishes by commit time).
- **Lanes and cars.** Every replica batches transactions into its own lane at its own rate. A car is one Propose and Vote exchange, and f+1 votes form a Proof of Availability (PoA), so at least one correct replica holds the data. A proposal references its predecessor and replicas vote for position i only after voting for i-1, so a certified tip proves its whole history. Autobahn deliberately skips reliable broadcast and does not stop Byzantine lanes from forking.
- **Consensus on cuts.** A slot leader proposes a vector of n certified tips. The protocol is PBFT-style: Prepare (2f+1 votes form a PrepareQC), then Confirm (2f+1 acks form a CommitQC), 5 mds in total. If the leader gathers all n Prepare votes it commits after 3 mds (fast path). A leader proposes only after at least n-f new tips (2f+1, tunable, called lane coverage), and the cost does not grow with the backlog.
- **Sync off the critical path.** Replicas vote without holding the data, then ask the f+1 replicas that certified a tip for the missing lane suffix, one request and one reply, and zip the lanes into one log with a deterministic function.
- **View change and parallel slots.** After a timeout certificate of 2f+1 complaints, the new leader re-proposes the higher of the highest PrepareQC and the highest proposal seen f+1 times, which covers both paths. Slots overlap (the next starts on the first Prepare of the previous), are bounded to k concurrent by CommitQC tickets, and election schedules are offset by f.
- **Optimizations and assurance.** Leader tips and optimistic (uncertified) tips cut inclusion latency, with weak and strong votes to avoid stalls. The appendix gives proofs of safety and liveness, a seamlessness argument, and a bound of f times the batch size on the never-committing data a correct replica may hold from Byzantine lanes.

## Methodology

The authors wrote a Rust prototype starting from the open-source Narwhal and Bullshark code, with Tokio TCP, RocksDB and ed25519-dalek. Baselines are Bullshark, BatchedHS (a HotStuff prototype that streams batches and proposes hashes, which the authors call an upper bound that is not robust) and VanillaHS (their change of it so batches travel only with the issuing replica's own proposals).

Everything ran on Google Cloud in four US regions (round trips between regions from 19 to 64 ms) on t2d-standard-16 machines, with co-located clients sending 512-byte no-op transactions, 500KB batches, rotating leaders, 1 s view timers and 60 s runs. Latency runs from arrival at a replica to readiness to execute, so client round trips are excluded. Good-case tests use n = 4 and scaling goes to 20. Blip tests use n = 4: a single leader failure (with HotStuff's one or two timeouts, and a 5 s timeout) and a 20 s partition into two halves.

## Findings

These are the authors' reported results.

- **Good intervals.** Autobahn matches Bullshark's throughput at about 234K tx/s and cuts latency 2.1× (592 ms to 280 ms), below BatchedHS (333 ms) and VanillaHS (365 ms). The authors count 7 mds for HotStuff, up to 12 for Bullshark (10.5 on average) and 4 for Autobahn on the fast path, 6 otherwise (with optimistic tips).
- **Throughput.** Autobahn and Bullshark lead BatchedHS (about 189K tx/s) by 1.23× and VanillaHS (about 15K tx/s) by 15.6×, and are limited by deserializing and storing data. BatchedHS suffers heavy data sync at high load, at times with view changes.
- **Ablations.** Forcing the slow path adds 40 ms and proposing only certified tips adds 33 ms. The graphs are omitted for space.
- **More replicas.** Autobahn and Bullshark scale gracefully to n = 20 with latency unaffected. BatchedHS loses 16% of throughput at n = 12 and 41% at n = 20. With latency capped at 2 s, VanillaHS falls from 15K to 1.5K tx/s.
- **Leader failures.** For a 3 s blip, VanillaHS reaches 6.2 s latency and is still at 1.3 s three seconds after the blip, against 365 ms in steady state. The authors report hangovers of 1.2× to 1.6× the blip duration across scenarios, and almost 7 s after a 5 s timeout. Autobahn at 220K tx/s recovers immediately.
- **Partition.** Lanes keep growing because replicas reach f+1 others, and one slot commits the whole backlog once the partition heals. About 1 s goes to moving and processing missing data, which the authors call an unavoidable hangover that the protocol did not cause. Bullshark and BatchedHS need about 9 s (Bullshark cannot advance its DAG without 2f+1 nodes, and BatchedHS must cap the batch references per proposal), and VanillaHS hangs over in proportion to the blip.

## Critical Analysis

The idea is clear and the evaluation answers the three questions it sets. The paper concedes several limits.

- **Optimistic tips give up seamlessness.** Section 5.5.2 and the appendix say they can put one data proposal per lane on the timeout-critical path, and the seamlessness argument does not cover them. The authors suggest adding 2Δ to the timeout and a replica-local reputation scheme, which is not implemented.
- **Not every hangover is avoided.** Bandwidth and catch-up after a partition remain, consensus can still stall during a blip, and lane coverage is best-effort, so a Byzantine leader that ignores it performs like a crashed one.
- **Parts are discussed, not built.** Pipelined cars, ride sharing and reputation are not in the prototype or the evaluation.

The following points are a reading of the evidence, not claims of the paper.

- **The headline configurations may differ.** The 280 ms latency uses optimistic tips, which the paper's own definition makes not seamless, and the text does not say whether the blip experiments used them. The certified-only price is 33 ms, so the gap is probably small, but it is not shown.
- **Blip evidence is thin.** The leader-failure figure plots only VanillaHS against Autobahn, saying Bullshark and BatchedHS behave like Autobahn, so the edge over DAG protocols rests on one partition test. The text calls their recovery "slightly longer" for about 9 s against about 1 s. The introduction says HotStuff's hangover after a 3 s blip is 30% longer than the blip, while Section 6.2 lists 1.6×, 1.3× and 1.2× "respectively" without tying each to a scenario, and the text does not reconcile the two.
- **Loads vary.** The partition test runs every system at 15K tx/s, under a tenth of Autobahn's peak, while the leader-failure test runs Autobahn at 220K and VanillaHS at 15K. Recovery from a partition at high load is not shown.
- **Faults are mild.** The blip tests use n = 4, one simulated leader failure and one partition. No run has an equivocating lane, withheld data or flooding, although fork garbage collection and bounded waste are argued analytically and optimistic tips are the part most exposed to Byzantine proposers.
- **Scaling is flat, not rising.** Total load is held constant as n grows, so the results show no loss, while the design claims throughput that scales with replicas. A footnote says constant per-replica rates would raise throughput with n, but that run is not shown. The text also says VanillaHS is "1.3 times slower" at n = 4 and "over 6.6 times slower" at n = 20 without naming the metric. At n = 4 it matches the latency ratio (365 ms against 280 ms), not the 15.6× throughput gap.
- **Narrow setup.** Transactions are no-ops, so execution cost is absent, and four US regions are far from a global blockchain. The text reports no repetitions or variance, and Shoal, the 9 mds Bullshark variant, is not run.

## Further Research

- Motorizing: the paper says an existing consensus can be augmented with lanes, cuts and its sync and ordering logic, but does not build or measure it.
- Byzantine experiments, larger and wider deployments with real execution, and the unbuilt reputation, ride-sharing and pipelined-car options.
- Removing timeouts, which Autobahn still needs for liveness. [Ambulance](/papers/ambulance-saving-bft-through-racing) (OSDI 2026) shares authors and builds on Autobahn's codebase and data layer to replace them. [Pesto](/papers/pesto-high-performance-bft-queries) (SOSP 2025) also shares authors and asks whether BFT databases need total order at all. Autobahn is earlier than both and cites neither, only Pesto's predecessor Basil, for caching repeated signatures.
- A measurable form of seamlessness, with a standard hangover metric across protocols, since the current argument is informal and sits in an appendix that the proceedings label as not peer-reviewed.
